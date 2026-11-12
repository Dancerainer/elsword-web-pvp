"""Search target2016 KOM models/scripts directly, without modifying input caches."""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, re, struct, sys, zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
READER = Path('asset_sources/upstream/tools/kom.py')

def reader():
    """Import the read-only archive reader only for actual source inspection."""
    if 'add_stardust_kom_reader' not in sys.modules:
        spec = importlib.util.spec_from_file_location('add_stardust_kom_reader', READER)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return sys.modules['add_stardust_kom_reader']

MODELS = {'.x', '.y', '.ksm', '.kac'}
SCRIPTS = {'.lua', '.txt', '.xml', '.ini', '.cfg', '.fx', '.h', '.c', '.cpp', '.json', '.csv', '.dsl', ''}
RELATED = re.compile(rb'[A-Za-z_][A-Za-z_0-9]*(?:STARDUST|STAR_DUST|METEOR_SHOWER)[A-Za-z_0-9]*', re.I)
IDENTIFIER = re.compile(rb'[A-Za-z_][A-Za-z_0-9]*')
QUERY = re.compile(rb'STARDUST|STAR_DUST|METEOR_SHOWER', re.I)
sha = lambda data: hashlib.sha256(data).hexdigest()

def expand_x(raw):
    """Validate every MSZIP block before searching binary/text DirectX names."""
    if raw[:4] != b'xof ' or raw[8:12] not in (b'bzip', b'tzip'):
        return raw
    if len(raw) < 26: raise ValueError('Truncated DirectX MSZIP header')
    declared, = struct.unpack_from('<I', raw, 16)
    if not 16 <= declared <= 256 * 1024 * 1024: raise ValueError('Invalid DirectX decoded size')
    blocks, cursor, window = [], 20, b''
    while cursor < len(raw):
        if cursor + 6 > len(raw): raise ValueError('Truncated MSZIP block header')
        unpacked, packed = struct.unpack_from('<HH', raw, cursor); end = cursor + 4 + packed
        if packed < 2 or unpacked > 32768 or end > len(raw) or raw[cursor+4:cursor+6] != b'CK':
            raise ValueError('Invalid MSZIP framing')
        inflater = zlib.decompressobj(-15, zdict=window) if window else zlib.decompressobj(-15)
        block = inflater.decompress(raw[cursor+6:end]) + inflater.flush()
        if not inflater.eof or inflater.unused_data or len(block) != unpacked: raise ValueError('Invalid MSZIP stream/size')
        blocks.append(block); window = (window + block)[-32768:]; cursor = end
    decoded = b''.join(blocks)
    if len(decoded) != declared - 16: raise ValueError('DirectX total decoded size mismatch')
    return raw[:8] + (b'bin ' if raw[8:12] == b'bzip' else b'txt ') + raw[12:16] + decoded

def kac_names(raw):
    """Read all declared KAC names without assuming the selected career files."""
    if raw.startswith(b'KSM '):
        if len(raw) < 32: raise ValueError('Truncated KSM header')
        magic, version, start = struct.unpack_from('<4sII', raw)
        if version != 0x200 or start > len(raw): raise ValueError('Invalid KSM animation offset/version')
        raw = raw[start:]
        if not raw: return []
    if not raw.startswith(b'KAC '): return None
    if len(raw) < 12: raise ValueError('Truncated KAC header')
    _, version, count = struct.unpack_from('<4sII', raw)
    if version != 0x100 or count > 4096 or 12 + 4*count > len(raw): raise ValueError('Invalid KAC header/count')
    result = []
    for i in range(count):
        offset, = struct.unpack_from('<I', raw, 12 + 4*i)
        if offset < 12 + 4*count or offset + 24 > len(raw): raise ValueError('Invalid KAC clip offset')
        pointer, reserved, tps, playback, tracks = struct.unpack_from('<IIdII', raw, offset)
        if pointer < offset + 24 or pointer + 4 > len(raw): raise ValueError('Invalid KAC name pointer')
        size, = struct.unpack_from('<I', raw, pointer)
        if size > 65536 or pointer + 4 + size > len(raw): raise ValueError('Invalid KAC name length')
        name = raw[pointer+4:pointer+4+size].decode('utf8')
        result.append({'name':name,'sourceAnimationIndex':i,'tracks':tracks,'ticksPerSecond':tps,'playbackField':playback,'reserved':reserved})
    return result

def scan_archive(args):
    kom = reader()
    path, client = map(Path, args); found, searched, motions, filenames, errors = [], [], [], [], []
    with path.open('rb') as stream:
        entries, xml = kom.index(stream)
        for ordinal, entry in enumerate(entries):
            name = entry['Name']; ext = Path(name).suffix.lower()
            if QUERY.search(name.encode('utf8')) or re.search(r'motion.*add|add.*motion', name, re.I): filenames.append({'name':name,'ordinal':ordinal})
            if ext not in MODELS | SCRIPTS: continue
            stream.seek(entry['offset']); raw = kom.unpack(entry, stream.read(int(entry['CompressedSize'])))
            decoded, codec = (raw, 'none') if ext in MODELS else kom.decode_asset(raw)
            row = {'archive':path.relative_to(client).as_posix(),'ordinal':ordinal,'name':name,'bytes':len(decoded),'sha256':sha(decoded),'assetCodec':codec}
            try: searchable = expand_x(decoded)
            except (ValueError,zlib.error) as error:
                errors.append({**row,'error':str(error)}); continue
            row['searchedBytes'] = len(searchable); searched.append(row)
            identifiers = sorted({m.group().decode('ascii') for m in IDENTIFIER.finditer(searchable) if QUERY.search(m.group())}) if QUERY.search(searchable) else []
            # UTF16 literal aliases may occur in text/config containers too.
            unicode_names = [name for name in ('SI_SA_ATT_STARDUST_SHOWER_LOOP','SI_SA_ATT_STARDUST_SHOWER_END','SI_SA_ATT_STARDUST_SHOWER_MEMO_END') if name.encode('utf-16le') in searchable]
            if identifiers or unicode_names: found.append({**row,'identifiers':identifiers,'utf16ExactNames':unicode_names})
            if ext in MODELS:
                try: names = kac_names(decoded)
                except (ValueError,struct.error) as error:
                    errors.append({**row,'error':str(error)}); continue
                if names and (re.search(r'motion.*add|add.*motion',name,re.I) or any(QUERY.search(n['name'].encode()) for n in names)):
                    motions.append({**row,'animations':names})
    return {'archive':path.relative_to(client).as_posix(),'archiveBytes':path.stat().st_size,'indexSha256':sha(xml),'entryCount':len(entries),
            'filenames':filenames,'searched':searched,'found':found,'motions':motions,'errors':errors}

def verify_selected_motion(client, output):
    """Re-read the five selected original packages and decode every key, not names alone."""
    sys.path.insert(0, str(ROOT/'tools/assets/character'))
    from ksm_convert import parse_ksm
    from export_ksm_sample import clips
    from build_rf import digest, json_bytes
    report = json.loads((output/'original-kom-search.json').read_text('utf8'))
    contract = json.loads((ROOT/'contracts/de-assets-motion-index.json').read_text('utf8'))
    selected = {name.lower() for name in contract['selection']['motions']}
    sources = [r for r in report['addMotionFamilies'] if r['name'].lower() in selected]
    if len(sources) != len(selected): raise ValueError('Selected original motion inventory mismatch')
    kom, records, seen, exported = reader(), [], {}, []
    temporary = output/'verified-original-motion'; temporary.mkdir(exist_ok=True)
    for source in sources:
        with (client/source['archive']).open('rb') as stream:
            entries, _ = kom.index(stream); entry = entries[source['ordinal']]
            if entry['Name'] != source['name']: raise ValueError('Original archive name mismatch')
            stream.seek(entry['offset']); raw = kom.unpack(entry, stream.read(int(entry['CompressedSize'])))
        if sha(raw) != source['sha256']: raise ValueError('Original motion changed since scan')
        path = temporary/source['name']; path.write_bytes(raw)
        decoded = parse_ksm(path); rows = []
        for native, clip in zip(decoded['animations'], clips(decoded)):
            signature = digest(json_bytes(clip, True)); name = clip['name']
            row = {'name':name, 'decodedKeysSha256':signature, 'durationSeconds':native['duration_seconds'],
                   'durationTicks':native['duration_ticks'], 'ticksPerSecond':native['ticks_per_second'], 'tracks':len(clip['tracks'])}
            rows.append(row)
            if name in seen:
                if seen[name] == signature: continue
                name += '__' + path.stem
            else: seen[name] = signature
            exported.append({'name':name, 'decodedKeysSha256':signature})
        records.append({k:v for k,v in source.items() if k != 'animations'} | {'clips':rows})
        print('verified original keys',source['name'],len(rows),flush=True)
    expected = {r['name']:r['decodedKeysSha256'] for r in contract['clips']}
    actual = {r['name']:r['decodedKeysSha256'] for r in exported}
    if actual != expected: raise ValueError('Converted motion contract omitted or altered original selected keys')
    proof = {'schemaVersion':1, 'evidenceLevel':'original-file-data', 'clientMeasured':False,
             'selectionContractSha256':sha((ROOT/'contracts/de-assets-motion-index.json').read_bytes()),
             'sources':records, 'rawClipCount':sum(len(r['clips']) for r in records),
             'exportedUniqueClipCount':len(actual), 'allExportedNamesAndKeysMatch':True}
    (output/'selected-motion-verification.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--client',type=Path,default=Path('asset_sources/client'))
    p.add_argument('--output',type=Path,default=ROOT/'.cache/add-stardust');p.add_argument('--workers',type=int,default=3)
    p.add_argument('--verify-selected-motion-only',action='store_true')
    a=p.parse_args()
    if a.output.resolve().is_relative_to(a.client.resolve()): raise ValueError('Output must be outside original client')
    a.output.mkdir(parents=True,exist_ok=True)
    if a.verify_selected_motion_only:
        verify_selected_motion(a.client,a.output);return
    paths=sorted(a.client.rglob('*.kom')); results=[]
    if not paths: raise ValueError('No original archives')
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        for i,result in enumerate(pool.map(scan_archive,((path,a.client) for path in paths)),1):
            results.append(result)
            if i%20==0: print('scanned',i,'/',len(paths),flush=True)
    allfiles=[row for r in results for row in r['searched']]
    raw=(json.dumps(allfiles,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf8');(a.output/'searched-files.json').write_bytes(raw)
    output={'schemaVersion':1,'clientMeasured':False,'clientRoot':str(a.client),'reader':{'path':str(READER),'sha256':sha(READER.read_bytes())},
      'search':{'allArchiveFilenames':True,'modelExtensions':sorted(MODELS),'scriptExtensions':sorted(SCRIPTS),'compressedDirectXExpanded':True,
        'aliasPolicy':'Actual identifier occurrences and every original Add KAC name are reported; similar names alone do not establish aliases.'},
      'counts':{'archives':len(results),'entries':sum(r['entryCount'] for r in results),'searchedFiles':len(allfiles),'searchedBytes':sum(r['searchedBytes'] for r in allfiles)},
      'searchedFiles':{'path':'searched-files.json','sha256':sha(raw),'bytes':len(raw)},
      'archives':[{k:v for k,v in r.items() if k not in ('searched','found','motions','errors')} for r in results],
      'occurrences':[row for r in results for row in r['found']], 'addMotionFamilies':[row for r in results for row in r['motions']],
      'errors':[row for r in results for row in r['errors']]}
    (a.output/'original-kom-search.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(output['counts']), 'errors',len(output['errors']),flush=True)
if __name__=='__main__': main()
