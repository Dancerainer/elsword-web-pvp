import importlib.util
from pathlib import Path
import hashlib
import json
import re
import tempfile
import unittest
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
spec = importlib.util.spec_from_file_location("damage_numbers", ROOT / "tools/assets/damage_numbers.py")
damage_numbers = importlib.util.module_from_spec(spec); spec.loader.exec_module(damage_numbers)
SOURCE = Path("asset_work")
CONTRACT = json.loads((ROOT / "contracts/rf-recovery-number-source-v17.json").read_text("utf-8"))
OUTPUT = ROOT / "artifacts/ui/damage-numbers"


class DamageNumberAssetsTest(unittest.TestCase):
    def target_bytes(self):
        record = CONTRACT["targetAssets"]["UIMajorParticle.txt"]
        return (SOURCE / record["raw_path"]).read_bytes()

    def test_original_source_integer_head_offset_width_and_ascii_alignment(self):
        documents = {}
        for record in CONTRACT["cppSources"]:
            data = (ROOT / record["localPath"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"])
            damage_numbers.verify_frozen_bytes(data, record)
            documents[record["relativePath"]] = data.decode("latin1")
        data = documents["X2Lib/X2Data.cpp"]
        self.assertRegex(data, r'm_pPicChar->SetWidth\( 30 \)')
        self.assertRegex(data, r'm_pPicCharRed->SetWidth\( 26 \)')
        self.assertRegex(data, r'm_pPicCharBlue->SetWidth\( 30 \)')
        self.assertRegex(data, r'm_pPicCharGreen->SetWidth\( 30 \)')
        self.assertIn('new CKTDGPicChar( m_pPicChar,', data)
        user = documents["X2Lib/X2GUUser.cpp"]
        self.assertIn('GetFramePos( &numPos, m_pFrame_Bip01_Head );', user)
        self.assertIn('numPos.y += 70.0f;', user)
        self.assertIn('DrawText( static_cast<int>( fFinalDamageToShow ), numPos, GetDirVector(), CKTDGPicChar::AT_CENTER )', user)
        pic = documents["KTDXLIB/KTDGPicChar.cpp"]
        self.assertIn('pos -= dirVec * (fWidth * str.size() / 2);', pic)
        self.assertIn('pos += dirVec * fWidth;', pic)
        self.assertIn('pParticle->SetTextureID( ch );', pic)
        self.assertIn('m_BillBoardType\t\t= CKTDGMatrix::BT_ALL;', documents["KTDXLIB/KTDGParticleSystem.cpp"])
        raven = documents["X2Lib/X2GURaven.cpp"]
        end = raven.split('void CX2GURaven::HyperModeBuffEffectEnd()', 1)[1].split('/** @function', 1)[0]
        self.assertIn('UpNowHp( GetMaxHp() * (m_fRageGauge * 0.0005f) );', end)
        self.assertIn('UpNowMp( m_fRageGauge );', end)
        self.assertNotIn('DrawText', end, 'this web adapter is not an original awakening-end text consumer')
        self.assertIn('strStream << L"HP+ " << (int)fUpRate;', user)
        self.assertIn('strStream << L"MP+ " << (int)fUpRate;', user)
        self.assertIn('pos.y += 50.0f;', user); self.assertIn('pos.y += 30.0f;', user)

    def test_actual_target_event_times_colors_and_zero_depth_test_are_preserved(self):
        data = self.target_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), CONTRACT["targetAssets"]["UIMajorParticle.txt"]["sha256"])
        parsed = damage_numbers.extract_templates(data)
        for name, lifetime, later_velocity, fade_start, color_start, color in [
            ("PicCharDamage", .8, .5, .7, .5, [1., .8, 0., 1.]),
            ("PicCharRed", 1.5, .8, 1.4, 1., [1., 0., 0., 1.]),
            ("PicCharGreen", 1.5, .8, 1.4, 1., [.3, 1., .3, 1.]),
            ("PicCharBlue", 1.5, .8, 1.4, 1., [.3, 1., 1., 1.])]:
            record = parsed[name]
            self.assertEqual(record["kind"], "particle"); self.assertEqual(record["unsupported"], [])
            self.assertEqual(record["fields"]["Lifetime"], lifetime)
            self.assertEqual(record["fields"]["NumParticles"], 100.)
            self.assertFalse(record["fields"]["ZEnable"]); self.assertFalse(record["fields"]["UseLand"])
            self.assertEqual(record["fields"]["Layer"], 21.)
            self.assertNotIn("BillBoardType", record["fields"], "a reference default must not rewrite the target declaration")
            velocities = [(e["start"], e["value"]) for e in record["events"] if e["property"] == "Velocity"]
            self.assertEqual(velocities, [(0., [0., 400., 0.]), (.1, [0., -400., 0.]), (.2, [0., 200., 0.]),
                (.25, [0., -200., 0.]), (.3, [0., 0., 0.]), (later_velocity, [0., 300., 0.])])
            sizes = [(e["start"], e["end"], e["value"]) for e in record["events"] if e["property"] == "Size"]
            self.assertEqual(sizes, [(0., 0., [40., 40., 1.]), (.2, .25, [40., 20., 1.]),
                (.25, .3, [40., 40., 1.]), (fade_start, lifetime, [40., 0., 1.])])
            colors = [e for e in record["events"] if e["property"] == "Color"]
            self.assertEqual(colors[0]["value"], color)
            self.assertEqual((colors[1]["start"], colors[1]["end"]), (color_start, lifetime))
            self.assertEqual(colors[1]["value"], color[:3] + [0.])

    def test_fourteen_published_pngs_have_exact_source_rgba_and_independent_byte_hashes(self):
        manifest = json.loads((OUTPUT / "manifest.json").read_text("utf-8"))
        self.assertEqual(manifest["sourceContractSha256"], hashlib.sha256((ROOT / manifest["sourceContract"]).read_bytes()).hexdigest())
        self.assertEqual(set(manifest["glyphs"]), set("0123456789HPM+")); self.assertFalse(manifest["nativeClientMeasured"])
        for digit, glyph in manifest["glyphs"].items():
            source = SOURCE / CONTRACT["targetAssets"]["PC_" + digit + ".dds"]["raw_path"]
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), glyph["source"]["sha256"])
            output = OUTPUT / glyph["file"]
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), glyph["sha256"])
            with Image.open(source) as original, Image.open(output) as published:
                original, published = original.convert("RGBA"), published.convert("RGBA")
                self.assertEqual(original.size, published.size)
                self.assertEqual(original.tobytes(), published.tobytes())
                self.assertEqual(hashlib.sha256(original.tobytes()).hexdigest(), glyph["rgbaSha256"])
            self.assertEqual(glyph["textureId"], ord(digit)); self.assertEqual(glyph["file"], "PC_" + digit + ".png")
        self.assertEqual(manifest["styles"], CONTRACT["bindings"]["styles"])
        self.assertEqual(manifest["recovery"]["classification"], "user-requested-web-display-adapter")
        self.assertFalse(manifest["recovery"]["targetRavenEndDrawText"])
        self.assertEqual(manifest["headOffsetY"], 70)

    def test_corrupt_or_missing_duplicate_templates_never_publish_guessed_defaults(self):
        source = self.target_bytes()
        compact = b"\n".join(re.search(rb'eventsequence\s+"' + name.encode() + rb'"\s*\{[^{}]*\}', source).group(0)
            for name in damage_numbers.TEMPLATE_NAMES)
        for broken in [compact[:-10], compact + compact, compact.replace(b'PicCharDamage', b'NotDamage'),
            compact.replace(b'XYZ(40,40,1)', b'XYZ(40,40)'), compact.replace(b'RGBA(1,0.8,0,1)', b'RGBA(1,nan,0,1)')]:
            with self.assertRaises(ValueError): damage_numbers.extract_templates(broken)

    def test_corrupt_dds_header_dimensions_and_payload_are_rejected(self):
        source = SOURCE / CONTRACT["targetAssets"]["PC_0.dds"]["raw_path"]
        data = source.read_bytes()
        for broken in [data[:20], b"bad " + data[4:], data[:4] + b"\0" * 4 + data[8:],
            data[:12] + b"\0" * 8 + data[20:], data[:84] + b"BAD!" + data[88:], data[:128]]:
            with self.assertRaises(ValueError): damage_numbers.decode_glyph_rgba(broken)

    def test_actual_recovery_templates_and_prefix_dds_reject_corruption(self):
        source = self.target_bytes()
        for name in ("PicCharGreen", "PicCharBlue"):
            block = re.search(rb'eventsequence\s+"' + name.encode() + rb'"\s*\{[^{}]*\}', source).group(0)
            for broken in [source + block, source.replace(block, block[:-1]),
                    source.replace(block, block.replace(b'XYZ(40,40,1)', b'XYZ(40,40)')),
                    source.replace(block, re.sub(rb'initial color\s*=\s*RGBA\([^)]*\)', b'initial color = RGBA(nan,1,1,1)', block))]:
                with self.assertRaises(ValueError): damage_numbers.extract_templates(broken)
        for char in "HPM+":
            data = (SOURCE / CONTRACT["targetAssets"]["PC_" + char + ".dds"]["raw_path"]).read_bytes()
            for broken in (data[:128], b"bad " + data[4:]):
                with self.assertRaises(ValueError): damage_numbers.decode_glyph_rgba(broken)

    def test_source_hash_change_is_rejected_before_decoding(self):
        record = CONTRACT["targetAssets"]["UIMajorParticle.txt"]
        with self.assertRaisesRegex(ValueError, "Frozen source"):
            damage_numbers.verify_frozen_bytes(self.target_bytes() + b" ", record)

    def test_source_or_external_output_paths_are_rejected_without_writing(self):
        for destination in [SOURCE / "damage-numbers-do-not-write", ROOT / "runtime/damage-numbers-do-not-write"]:
            with self.assertRaisesRegex(ValueError, "this task's artifacts"):
                damage_numbers.build(SOURCE, destination, report_path=None)
            self.assertFalse(destination.exists())

    def test_actual_rebuild_is_byte_and_pixel_deterministic(self):
        (ROOT / 'runtime').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="damage-number-test-", dir=ROOT / "runtime") as temp:
            rebuilt = damage_numbers.build(SOURCE, Path(temp), report_path=None, output_root=Path(temp))
            current = json.loads((OUTPUT / "manifest.json").read_text("utf-8"))
            self.assertEqual(rebuilt, current)
            self.assertEqual((Path(temp) / "manifest.json").read_bytes(), (OUTPUT / "manifest.json").read_bytes())
            for digit in rebuilt["glyphs"]:
                self.assertEqual((Path(temp) / rebuilt["glyphs"][digit]["file"]).read_bytes(), (OUTPUT / current["glyphs"][digit]["file"]).read_bytes())

    def test_explicit_rebuild_root_cannot_authorize_shared_or_escaped_outputs(self):
        for root, destination in ((SOURCE, SOURCE / 'must-not-write'),
                (ROOT / 'runtime', ROOT / 'runtime/must-not-write'),
                (ROOT / 'runtime/private-rebuild', ROOT / 'outside-must-not-write')):
            with self.assertRaises(ValueError):
                damage_numbers.build(SOURCE, destination, report_path=None, output_root=root)
            self.assertFalse(destination.exists())


if __name__ == "__main__": unittest.main()
