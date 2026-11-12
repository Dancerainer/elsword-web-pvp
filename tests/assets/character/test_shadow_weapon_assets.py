"""Independent target dependency and actual-DLL GetKeys checks, no combat gold."""
import base64
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/assets/character"))
sys.path.insert(0, str(Path(__file__).parent))
from build_rf import load_x
from build_rf_fx import select_templates
from directx_animation import decode_animations
from native_d3dx_keys import decode_measured_native_keys, SHADOW_REQUEST, SHADOW_MANIFEST, SHADOW_REQUEST_SHA
from test_full_skill_assets import sdk_srt_channel
from asset_evidence import evidence_path


class ShadowWeaponAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.roots = json.loads((ROOT / "contracts/rf-shadow-weapon-resource-roots.json").read_text("utf-8"))
        cls.index = json.loads((ROOT / "contracts/rf-shadow-weapon-fx-index.json").read_text("utf-8"))
        cls.request_bytes = (ROOT / SHADOW_REQUEST).read_bytes()
        cls.request = json.loads(cls.request_bytes)
        cls.manifest = json.loads((ROOT / SHADOW_MANIFEST).read_bytes())
        cls.artifact_bytes = evidence_path(cls.manifest["artifact"]["path"]).read_bytes()
        cls.artifact = json.loads(cls.artifact_bytes)
        cls.execution = json.loads((ROOT / "reports/rf-shadow-weapon-d3dx-execution.json").read_bytes())

    def test_exact_target_buster_three_bullets_and_damage_descendant_closure(self):
        roots = self.roots
        self.assertFalse(roots["clientMeasured"])
        effect = roots["effectSets"]["EffectSet_Raven_Shadow_Buster"]
        self.assertEqual(effect["sourcePc"], {"prototype": 3, "instruction": 129430})
        for i in range(3):
            entry = effect["raw"][f"EFFECT{i}"]
            self.assertEqual(entry, {"START_TIME": .01, "NAME": f"DAMAGE_EFFECT_SHADOW_BACK_SLIDE_BULLET_{i+1}", "BONE_NAME": "Bip01", "EFFECT_TYPE": 1})
            bullet = roots["damageEffects"][entry["NAME"]]["raw"]
            self.assertEqual(bullet["DAMAGE_DATA"]["CREATE_DAMAGE_EFFECT_NAME"], "DAMAGE_EFFECT_SHADOW_BURSTER_EXPLOSION")
            self.assertEqual(bullet["DIE_DAMAGE_EFFECT0"]["DAMAGE_EFFECT_NAME"], "DAMAGE_EFFECT_SHADOW_BURSTER")
            self.assertIn(bullet["MAIN_EFFECT_NAME"], self.index["templates"])
        self.assertEqual(len(roots["damageEffects"]), 6)
        self.assertIn("DAMAGE_EFFECT_SHADOW_BURSTER_Flame_Damage", roots["damageEffects"])
        self.assertIn("RVC_NAPALM_BOMB_EXPLOSION_ATTACKBOX", self.index["templates"])
        self.assertEqual((self.index["missingTemplates"], self.index["meshFailures"]), ([], []))
        definitions = copy.deepcopy(self.index["templates"])
        del definitions["RVC_C_ShadowBackSlide_grenade_M01_2"]
        _, missing = select_templates(definitions, roots)
        self.assertEqual(missing, ["RVC_C_ShadowBackSlide_grenade_M01_2"])

    def test_weapon_break_head_consumer_offsets_trace_sound_and_atlas_are_preserved(self):
        raw = self.roots["effectSets"]["EffectSet_DEBUFF_WEAPON_BREAK"]["raw"]["EFFECT0"]
        self.assertEqual(raw, {"BONE_NAME": "_HEAD_BONE", "NAME": "StateError_Weapon_Break01", "POSITION_OFFSET_Y": 100, "EFFECT_TYPE": 8, "TRACE": 1})
        template = self.index["templates"][raw["NAME"]]
        self.assertEqual(template["unsupported"], [])
        self.assertEqual(set(template["textures"]), {"Weapon_Break01.dds"})
        buff = self.roots["buffTemplates"]["48"]["raw"]
        self.assertEqual(buff["DISPLAYER"]["BDT_SOUND"], {"1": "Raven_Weapon_Break_SwordCrack.ogg"})
        audio = json.loads(evidence_path("artifacts/rf-shadow-weapon/audio/manifest.json").read_bytes())
        self.assertEqual(set(audio["files"]), {"Raven_ShadowBackSlide2.ogg", "Raven_Weapon_Break_SwordCrack.ogg",
            "Raven_DashJumpXXXFireBoom.ogg", "RWT_COMBO_X_IMPACT.ogg"})
        self.assertTrue(all(v["crcValidated"] for v in audio["files"].values()))
        atlas = json.loads(evidence_path("artifacts/rf-shadow-weapon/ui/manifest.json").read_bytes())["textures"]
        self.assertEqual(atlas[buff["BUFF_ICON_TEXTURE_NAME"]]["textureKeys"], ["Debuff_Icon_Weapon_Break"])
        self.assertIsNone(atlas[buff["BUFF_ICON_TEXTURE_NAME"]]["cropCoordinates"])

    def test_actual_two_original_dll_models_all_24_groups_and_32_sdk_srt_poses(self):
        self.assertEqual(hashlib.sha256(self.request_bytes).hexdigest(), SHADOW_REQUEST_SHA)
        self.assertEqual(len(self.request["sources"]), 2)
        gold = {t["sourceSha256"]: t for t in self.execution["traces"] if t.get("sourceSha256")}
        groups = poses = channels = 0
        for source in self.request["sources"]:
            parsed = decode_animations(load_x(Path(source["source"])), include_native_matrices=True)
            self.assertIsNone(parsed[0]["ticks_per_second"])
            decoded = decode_measured_native_keys(source["source"], parsed, self.temporary_repo())
            clip = decoded[0]
            self.assertEqual(clip["name"], "Normal")
            self.assertEqual(clip["ticks_per_second"], 4800)
            self.assertEqual(clip["duration_seconds"], source["nativeAnimations"][0]["period"])
            self.assertEqual(clip["native_d3dx_evidence"]["manifest"], SHADOW_MANIFEST)
            # A combined profession registry may record the same original X
            # in another independently measured receipt. Both paths must keep
            # every original SDK key byte, period and set identity unchanged.
            combined = decode_measured_native_keys(source["source"], parsed)[0]
            for key in ('name','ticks_per_second','duration_seconds','nativePlaybackField','tracks'):
                self.assertEqual(combined[key],clip[key])
            for actual_track, original_track in zip(combined['tracks'],clip['tracks']):
                for prop in ('translation','scale','rotation'):
                    pack=lambda track:b''.join(struct.pack('<'+'f'*len(row),*row) for row in track[prop]['values'])
                    self.assertEqual(pack(actual_track),pack(original_track))
            self.assertEqual(combined['native_d3dx_evidence']['source_sha256'],source['sourceSha256'])
            self.assertEqual(combined['native_d3dx_evidence']['dll_sha256'],self.manifest['dll']['sha256'])
            native = next(v for v in self.artifact["sources"] if v["sourceSha256"] == source["sourceSha256"])
            tracks = {t["frame_name"]: t for t in clip["tracks"]}
            for channel in native["animations"][0]["channels"]:
                channels += 1
                track = tracks[channel["name"]]
                for key, prop in (("translationKeys", "translation"), ("scaleKeys", "scale"), ("rotationKeys", "rotation")):
                    group = channel[key]
                    raw = base64.b64decode(group["keyBytesBase64"])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), group["keyBytesSha256"])
                    rows = list(struct.iter_unpack("<" + "f" * group["stride"], raw))
                    self.assertEqual(track[prop]["ticks"], [r[0] for r in rows])
                    for actual, row in zip(track[prop]["values"], rows):
                        expected = [-x if prop == "rotation" and i < 3 else x for i, x in enumerate(row[1:])]
                        self.assertEqual(actual, expected)
                        for x, y in zip(actual, expected):
                            if x == 0: self.assertEqual(math.copysign(1, x), math.copysign(1, y))
                    groups += 1
            for channel in gold[source["sourceSha256"]]["animations"][0]["channels"]:
                track = tracks[channel["name"]]
                for pose in channel["poses"]:
                    for prop in ("translation", "scale", "rotation"):
                        actual = sdk_srt_channel(track[prop], pose["timeSeconds"], prop == "rotation")
                        expected = pose[prop]
                        if prop == "rotation" and sum(x*y for x, y in zip(actual, expected)) < 0: actual = [-x for x in actual]
                        # Exact key bytes above; original DLL SRT arithmetic and
                        # JSON float32 serialization use the existing bound.
                        magnitude = max(abs(x) for row in track[prop]["values"] for x in row)
                        tolerance = 2e-6 if prop == "rotation" else max(3e-6, magnitude*5e-7)
                        for x, y in zip(actual, expected): self.assertAlmostEqual(x, y, delta=tolerance)
                    poses += 1
        self.assertEqual((channels, groups, poses), (8, 24, 32))

    def temporary_repo(self):
        (ROOT / 'runtime').mkdir(exist_ok=True)
        temp = tempfile.TemporaryDirectory(prefix='shadow-native-test-',dir=ROOT / 'runtime')
        self.addCleanup(temp.cleanup)
        repo = Path(temp.name)
        for name, data in ((SHADOW_REQUEST, self.request_bytes), (SHADOW_MANIFEST, json.dumps(self.manifest).encode()), (self.manifest["artifact"]["path"], self.artifact_bytes)):
            destination = repo / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        return repo

    def test_corrupt_new_registry_artifact_or_exact_set_name_cannot_fallback(self):
        source = self.request["sources"][0]["source"]
        parsed = [{"name": "Normal"}]
        repo = self.temporary_repo()
        (repo / self.manifest["artifact"]["path"]).unlink()
        with self.assertRaisesRegex(ValueError, "artifact missing"):
            decode_measured_native_keys(source, parsed, repo)
        repo = self.temporary_repo()
        request = copy.deepcopy(self.request)
        request["sources"][0]["sourceSha256"] = "0" * 64
        (repo / SHADOW_REQUEST).write_text(json.dumps(request), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "registry hash mismatch"):
            decode_measured_native_keys(source, parsed, repo)
        repo = self.temporary_repo()
        with self.assertRaisesRegex(ValueError, "names differ"):
            decode_measured_native_keys(source, [{"name": "alias-Normal"}], repo)
        with tempfile.TemporaryDirectory() as directory:
            renamed = Path(directory) / Path(source).name
            renamed.write_bytes(Path(source).read_bytes() + b"corrupt")
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                decode_measured_native_keys(renamed, parsed, repo)

    def test_generated_pose_helpers_duration_and_inventory_preserve_legacy_proof(self):
        directory = evidence_path("artifacts/rf-shadow-weapon/fx/meshes")
        for name, period in (("BREAKING_FIST_Attack_Box", 1.), ("RVC_C_ShadowBackSlide_grenade", 5.233333110809326)):
            pose = json.loads((directory / (name + ".pose.json")).read_bytes())
            self.assertEqual(pose["unsupportedTracks"], [])
            self.assertTrue(pose["clips"][0]["nativeD3dxKeys"])
            self.assertEqual(pose["clips"][0]["durationSeconds"], period)
            self.assertEqual(pose["observedClock"]["report"], "reports/rf-shadow-weapon-d3dx-execution.json")
        grenade = self.index["templates"]["RVC_C_ShadowBackSlide_grenade_M01_1"]
        self.assertEqual(grenade["fields"]["LifeTime"], 1.2)
        self.assertEqual(grenade["fields"]["Gravity"], [0., -2000., 0.])
        self.assertTrue(grenade["fields"]["UseLand"])
        self.assertFalse(grenade["animationRequiresUnconfirmedRate"])
        report = json.loads((ROOT / "reports/rf-shadow-weapon-assets.json").read_bytes())
        for entry in report["outputInventory"]:
            data = evidence_path(entry["path"]).read_bytes()
            self.assertEqual(len(data), entry["bytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
        self.assertEqual(hashlib.sha256((ROOT / "reports/rf-full-skill-assets.json").read_bytes()).hexdigest(), "74cccac35c5fd444b6d4b5b2821fec16326c001d01b8012b28d6b10f989d7b53")
        # The tracked proof JSON uses Git LF. Some older Windows worktrees
        # retain CRLF; only this text comparison normalizes line endings.
        # Original-DLL key groups and generated assets above remain byte exact.
        old_proof = (ROOT / "reports/rf-buff-display-assets.json").read_bytes().replace(b"\r\n", b"\n")
        self.assertEqual(hashlib.sha256(old_proof).hexdigest(), "b581b46b233d71d710dde9fc2c4bbbf6f3f89c99b3cac506dd19e78120094383")


if __name__ == "__main__":
    unittest.main()
