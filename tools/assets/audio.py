"""Copy RF sound dependencies from verified raw files, without transcoding.

Target SOUND_PLAY/SOUND_SET literals and explicitly labelled V5 reference triggers
remain separate. No client execution or engine timing/default inference occurs.
The catalog and raw assets are opened read-only; output stays outside upstream.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import struct


VERSION = "rf-audio-2016-v2"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def sound_references(profile, reference_sounds=None):
    """Keep literal source event arrays and set rates; collect no unrelated paths."""
    states, names = {}, set()

    def collect(value):
        if isinstance(value, str) and value.casefold().endswith(".ogg"):
            # No directories or executable paths are accepted from the profile.
            if value != Path(value).name or "/" in value or "\\" in value or "\0" in value:
                raise ValueError("Unsafe sound filename: " + value)
            names.add(value)
        elif isinstance(value, dict):
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for name, state in profile["states"].items():
        raw = state["raw"]
        declarations = {key: value for key, value in raw.items()
            if re.fullmatch(r"SOUND_(?:PLAY|SET)\d+(?:_RATE)?", key)}
        if declarations:
            collect(declarations)
            states[name] = {"animationName": state.get("animationName"), "rawSoundDeclarations": declarations}
    # DamageEffect SOUNDn is a separate original mesh-clock consumer. These
    # sounds also play on misses, so collecting only actor SOUND_PLAY/SET loses
    # projectile/impact/overheat audio even though the combat event is emitted.
    for declarations in effect_sound_references(profile).values():
        collect(declarations)
    if reference_sounds:
        if reference_sounds.get("evidence") != "reference-v5; target triggers unmeasured":
            raise ValueError("Reference sound triggers must retain their evidence classification")
        for entry in reference_sounds["files"]:
            collect(entry["name"])
    return states, sorted(names)


def effect_sound_references(profile):
    return {name: records for name, row in profile.get("damageEffects", {}).items()
            if (records := {key: value for key, value in row["raw"].items()
                            if re.fullmatch(r"SOUND\d+", key)})}


def reference_sound_contract(profile, supplied=None):
    # RF and VC use the same native Raven core callbacks. The fixed-reference
    # roots belong to this shared extractor, not only VC's current asset job.
    if profile.get('target', {}).get('unitClass') not in (106, 107, 115):
        return supplied
    path = Path(__file__).resolve().parents[2]/'contracts/raven-core-attack-sounds-v5.json'
    shared = json.loads(path.read_text('utf8'))
    if supplied is None:
        return shared
    if supplied.get('evidence') != shared['evidence']:
        raise ValueError('Reference sound triggers must retain their evidence classification')
    names = {row['name'] for row in supplied['files']}
    return {**supplied, 'files': [*supplied['files'], *(row for row in shared['files'] if row['name'] not in names)],
            'sharedReferenceContract': 'contracts/raven-core-attack-sounds-v5.json'}


def crc_table():
    table = []
    for initial in range(256):
        value = initial << 24
        for _ in range(8):
            value = ((value << 1) ^ (0x04C11DB7 if value & 0x80000000 else 0)) & 0xffffffff
        table.append(value)
    return table


CRC_TABLE = crc_table()


def ogg_crc(data):
    value = 0
    for byte in data:
        value = ((value << 8) & 0xffffffff) ^ CRC_TABLE[((value >> 24) ^ byte) & 255]
    return value


def inspect_ogg(data):
    """Validate page framing/CRC/packet continuity and original Vorbis header.

    Container validation is distinct from listening or browser playback testing.
    No compressed audio packet values are rewritten or interpreted as game rules.
    """
    cursor, pages, streams = 0, 0, {}
    while cursor < len(data):
        if cursor + 27 > len(data) or data[cursor:cursor+4] != b"OggS":
            raise ValueError("Truncated or missing Ogg page header")
        if data[cursor+4] != 0 or data[cursor+5] & ~7:
            raise ValueError("Unsupported Ogg version/header flags")
        flags = data[cursor+5]
        granule, serial, sequence, checksum = struct.unpack_from("<QIII", data, cursor+6)
        count = data[cursor+26]
        segments_end = cursor + 27 + count
        if segments_end > len(data):
            raise ValueError("Truncated Ogg segment table")
        segments = data[cursor+27:segments_end]
        end = segments_end + sum(segments)
        if end > len(data):
            raise ValueError("Truncated Ogg page body")
        page = bytearray(data[cursor:end]); page[22:26] = b"\0" * 4
        if ogg_crc(page) != checksum:
            raise ValueError("Ogg page CRC mismatch")
        if serial not in streams:
            if not flags & 2 or sequence != 0:
                raise ValueError("Ogg stream does not start with BOS/sequence zero")
            streams[serial] = {"nextSequence": 0, "partial": bytearray(), "header": None,
                "eos": False, "lastGranule": None}
        stream = streams[serial]
        if sequence != stream["nextSequence"] or stream["eos"]:
            raise ValueError("Ogg stream sequence mismatch or page after EOS")
        if bool(flags & 1) != bool(stream["partial"]):
            raise ValueError("Ogg continuation flag does not match packet boundary")
        stream["nextSequence"] += 1
        position = segments_end
        for length in segments:
            stream["partial"].extend(data[position:position+length]); position += length
            if len(stream["partial"]) > 8 * 1024 * 1024:
                raise ValueError("Ogg packet exceeds supported size")
            if length < 255:
                packet = stream["partial"]; stream["partial"] = bytearray()
                if stream["header"] is None:
                    if len(packet) != 30 or packet[:7] != b"\x01vorbis":
                        raise ValueError("Expected original Vorbis identification packet")
                    version, = struct.unpack_from("<I", packet, 7)
                    channels = packet[11]; sample_rate, = struct.unpack_from("<I", packet, 12)
                    if version != 0 or channels == 0 or sample_rate == 0 or packet[29] != 1:
                        raise ValueError("Invalid Vorbis identification header")
                    small, large = packet[28] & 15, packet[28] >> 4
                    if not 6 <= small <= large <= 13:
                        raise ValueError("Invalid Vorbis block-size exponents")
                    stream["header"] = {"codec": "vorbis", "channels": channels,
                        "sampleRate": sample_rate, "bitrateNominalRaw": struct.unpack_from("<i", packet, 20)[0],
                        "blockSizes": [1 << small, 1 << large]}
        if granule != 0xffffffffffffffff:
            stream["lastGranule"] = granule
        if flags & 4:
            if stream["partial"]:
                raise ValueError("Ogg stream ends inside a packet")
            stream["eos"] = True
        cursor = end; pages += 1
    if not streams or any(not stream["eos"] or stream["header"] is None for stream in streams.values()):
        raise ValueError("Incomplete Ogg stream")
    if len(streams) != 1:
        raise ValueError("Chained/multiplexed Ogg requires separate validation")
    stream = next(iter(streams.values()))
    return {**stream["header"], "pages": pages, "crcValidated": True,
        "finalGranuleSamples": stream["lastGranule"],
        "containerDurationSeconds": stream["lastGranule"] / stream["header"]["sampleRate"]
            if stream["lastGranule"] is not None else None}


def build(profile_path, source_root, output, report_path, reference_path=None):
    profile_path, source_root, output = profile_path.resolve(), source_root.resolve(), output.resolve()
    if output.is_relative_to(source_root) or report_path.resolve().is_relative_to(source_root):
        raise ValueError("Output/report must not modify upstream")
    profile_bytes = profile_path.read_bytes(); profile = json.loads(profile_bytes)
    reference_sounds = json.loads(reference_path.read_text("utf-8")) if reference_path else None
    reference_sounds = reference_sound_contract(profile, reference_sounds)
    states, names = sound_references(profile, reference_sounds)
    connection = sqlite3.connect((source_root / "catalog.sqlite").as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    files, failures = {}, []
    output.mkdir(parents=True, exist_ok=True)
    for name in names:
        rows = [dict(row) for row in connection.execute(
            "SELECT archive, ordinal, name, raw_path, sha256 FROM assets WHERE status='ok' AND name=? COLLATE NOCASE", (name,))]
        if not rows or len({row["sha256"] for row in rows}) != 1:
            failures.append({"name": name, "reason": "missing/ambiguous original catalog entry"}); continue
        row = min(rows, key=lambda row: (row["archive"], row["ordinal"]))
        source = (source_root / row["raw_path"]).resolve()
        if not source.is_relative_to(source_root / "raw"):
            raise ValueError("Catalog path escapes original raw input directory")
        data = source.read_bytes()
        if sha256(data) != row["sha256"]:
            raise ValueError("Original source SHA256 differs from catalog: " + name)
        try:
            metadata = inspect_ogg(data)
        except ValueError as error:
            failures.append({"name": name, "reason": str(error)}); continue
        (output / name).write_bytes(data)
        if sha256((output / name).read_bytes()) != row["sha256"]:
            raise ValueError("Copied audio SHA256 differs from original: " + name)
        files[name] = {"file": name, "sha256": row["sha256"], "bytes": len(data),
            "mimeType": 'audio/ogg; codecs="vorbis"', "source": row, **metadata}
    connection.close()
    manifest = {"schemaVersion": 1, "converterVersion": VERSION, "clientMeasured": False,
        "profile": {"path": str(profile_path), "sha256": sha256(profile_bytes.replace(b'\r\n', b'\n')), "hashNormalization": "UTF-8 LF",
            "profileId": profile.get("profileId"), "target": profile.get("target")},
        "files": files, "states": states, "effectSounds": effect_sound_references(profile),
        "referenceTriggers": reference_sounds, "unsupported": failures,
        "limits": ["Original Vorbis bytes are copied without transcoding.",
            "Explicit V5 sound triggers use target audio bytes; their 2016 trigger behavior remains unmeasured.",
            "Source SOUND_PLAY event clocks, SOUND_SET selection, and native sound gain are not inferred by this extractor.",
            "Container CRC/header checks do not certify browser autoplay, audible output, or original-client timing."]}
    write_json(output / "manifest.json", manifest)
    report = {"schemaVersion": 1, "converterVersion": VERSION, "outputDirectory": str(output),
        "toolSha256": sha256(Path(__file__).read_bytes()), "profile": manifest["profile"],
        "summary": {"referencedStates": len(states), "uniqueAudioReferences": len(names),
            "referencedDamageEffects": len(effect_sound_references(profile)),
            "referenceTriggers": len(reference_sounds["files"]) if reference_sounds else 0,
            "copiedFiles": len(files), "bytes": sum(file["bytes"] for file in files.values()), "unsupported": len(failures)},
        "referenceTriggers": reference_sounds,
        "clientMeasured": False, "files": files, "unsupported": failures, "limits": manifest["limits"]}
    write_json(report_path, report)
    print(json.dumps(report["summary"]))
    if failures:
        raise ValueError("Referenced audio dependencies remain unsupported; see report")
    return manifest


def self_test():
    """Small authored framing fixture and damaged-input cases; no game payloads."""
    packet = b"\x01vorbis" + struct.pack("<IBIiiiBB", 0, 1, 48000, 0, 0, 0, 0x86, 1)
    page = bytearray(b"OggS\0\x06" + struct.pack("<QIII", 0, 1, 0, 0) + bytes([1, len(packet)]) + packet)
    struct.pack_into("<I", page, 22, ogg_crc(page))
    assert inspect_ogg(page)["sampleRate"] == 48000
    broken = bytearray(page); broken[-1] ^= 1
    for data in (b"", page[:12], page[:-1], broken):
        try:
            inspect_ogg(data)
        except ValueError:
            pass
        else:
            raise AssertionError("Damaged Ogg framing was accepted")
    assert sound_references({"states": {"Example": {"raw": {"SOUND_PLAY0": {"1": .2, "2": "Example.ogg"}}}}})[1] == ["Example.ogg"]
    print("Authored Ogg framing, CRC, truncation, and profile-reference checks passed.")


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--profile", type=Path)
    arguments.add_argument("--source-root", type=Path, default=Path("asset_work"))
    arguments.add_argument("--output", type=Path, default=Path("artifacts/audio"))
    arguments.add_argument("--report", type=Path, default=Path("reports/rf-audio.json"))
    arguments.add_argument("--reference-sounds", type=Path, help="Explicit source-labelled native reference triggers")
    arguments.add_argument("--self-test", action="store_true")
    args = arguments.parse_args()
    if args.self_test:
        self_test()
    if args.profile:
        build(args.profile, args.source_root, args.output, args.report, args.reference_sounds)
    elif not args.self_test:
        arguments.error("--profile is required unless using --self-test")


if __name__ == "__main__":
    main()
