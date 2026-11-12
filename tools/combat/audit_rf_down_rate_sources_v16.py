"""Read-only fixed-source clock and target video-option evidence; no target tick-rate inference."""
import argparse
import json
from pathlib import Path
from audit_rf_hit_sources_v14 import ROOT, REFERENCE, file_evidence, method_span, sha
from kl82_static import read_declarations


def line_span(path, first, last, tokens):
    raw = b''.join(path.read_bytes().splitlines(keepends=True)[first - 1:last])
    if any(token.encode('ascii') not in raw for token in tokens):
        raise ValueError(f'Fixed clock source span drift: {path}:{first}-{last}')
    return {'firstLine': first, 'lastLine': last, 'bytes': len(raw), 'sha256': sha(raw)}


def build():
    methods = {
        '.cache/native-source-runtime/X2/X2.cpp': ['void CALLBACK OnFrameMove( IDirect3DDevice9*'],
        '.cache/native-reference/X2Lib/X2Game.cpp': ['HRESULT\tCX2Game::OnFrameMove('],
        '.cache/native-reference/X2Lib/X2GameUnit.cpp': ['/*virtual*/ HRESULT CX2GameUnit::OnFrameMove('],
    }
    files = [{**file_evidence(ROOT / path, path), 'methods': [method_span(ROOT / path, s) for s in signatures]}
             for path, signatures in methods.items()]
    header = ROOT / '.cache/native-source-runtime/KTDXLIB/KTDXApp.h'
    lines = header.read_bytes().splitlines(keepends=True)
    raw = b''.join(lines[104:108])
    if b'GetElapsedTime(){ return m_fConstElapsedTime; }' not in raw or b'm_fConstElapsedTime = 1.0f/fFrameRate' not in raw:
        raise ValueError('Fixed App elapsed/frame-rate accessor drift')
    files.append({**file_evidence(header, '.cache/native-source-runtime/KTDXLIB/KTDXApp.h'),
                  'lineSpans': [{'firstLine': 105, 'lastLine': 108, 'bytes': len(raw), 'sha256': sha(raw)}]})
    clock_files = {
        'KTDXLIB/KTDXApp.cpp': ('b0118343485aa657194ab97a2eef9b81639abd3c',
            ['HRESULT CKTDXApp::OnFrameMove(', 'void CKTDXApp::FrameProcess( bool bStop )',
             'void CKTDXApp::FrameProcess()'],
            [(300, 304, ['DOWN_FRAME_TEST', '1.0f/85.0f']),
             (609, 612, ['m_fConstElapsedTime * 1000', 'm_fFrameTimestampFraction']),
             (740, 743, ['fRealElapsedTime <= m_fConstElapsedTime']),
             (792, 829, ['while( fRealElapsedTime > m_fConstElapsedTime )', 'fRealElapsedTime -= m_fConstElapsedTime']),
             (923, 959, ['fElapsedTime = m_fConstElapsedTime', 'fElapsedTime = 0.f', 'm_fSlowFactor',
                          'OnFrameMove( fElapsedTime, m_fConstElapsedTime )']),
             (1064, 1067, ['OnFrameMove( m_dTime, m_fConstElapsedTime )'])]),
        'X2Lib/X2Main.cpp': ('47bc0f8ead8456572a3b7c573151606dae556d64',
            ['bool CX2Main::StateChange( int stateID, int iDetailStateID )'],
            [(5368, 5372, ['DOWN_FRAME_TEST', 'SetFrameRate( 75.f )']),
             (5470, 5478, ['XS_PVP_GAME', 'OPTIMIZED_P2P', 'DOWN_FRAME_TEST', 'SetFrameRate( 85.f )'])]),
        'X2Lib/X2GameOption.cpp': ('6326535c3fb819ec4af447d734ca94d9f4f8a15b', [],
            [(951, 952, ['VIDEO_FPS_INDEX', 'VIDEO_FPS', '30.0f'])]),
        'X2/KOGGamePerformanceCheckDefine.h': ('7b14aae19c5f637272f63696e2a144f39019e69a', [], []),
    }
    for name, (blob, signatures, spans) in clock_files.items():
        relative = '.cache/clock-source-v16/' + name
        path = ROOT / relative
        entry = file_evidence(path, relative)
        if entry['gitBlob'] != blob:
            raise ValueError('Pinned clock Git blob drift: ' + name)
        entry.update({'repositoryPath': 'JP_TW_EU_CN_US/Trunk/' + name,
                      'acquiredVia': 'bounded-read-only-Gitea-git-blob-API',
                      'sourceUrl': 'git-blob:' + blob,
                      'methods': [method_span(path, signature) for signature in signatures],
                      'lineSpans': [line_span(path, first, last, tokens) for first, last, tokens in spans]})
        files.append(entry)
    flags = ROOT / '.cache/native-source-runtime/KTDXLIB/KTDX.h'
    files.append({**file_evidence(flags, '.cache/native-source-runtime/KTDXLIB/KTDX.h'),
                  'lineSpans': [line_span(flags, 151, 153, ['_FOREIGN_', '#define OPTIMIZED_P2P']),
                                line_span(flags, 555, 557, ['X2TOOL', '#define CHANGE_KEY_DEVICE'])]})
    target = Path('asset_work/raw/data/data036.kom/DefaultGameOptions.lua')
    enum = target.with_name('Enum.lua')
    options = read_declarations(target, read_declarations(enum)['globals'])['globals']['DEFAULT_GAME_OPTION']
    selected = {key: options[key] for key in ('VIDEO_FPS', 'VIDEO_FPS_INDEX', 'VERTICALSYNC')}
    return {'schema': 'rf-down-hit-rate-source-v16', 'referenceCommit': REFERENCE,
        'evidenceClass': 'pinned-V5-clock-producer-and-delta-dispatch + target2016-video-option-declarations',
        'targetClientMeasured': False, 'originalClientMeasurementCount': 0,
        'sourceFiles': files, 'targetVideoOptions': {**file_evidence(target), 'fields': selected,
            'enumSource': file_evidence(enum)},
        'missingDeltaProducers': [],
        'referenceClock': {'scheduler': 'constant-step sleep-or-catch-up loop',
            'normalInitialHz': 85, 'normalStateChangeDefaultHz': 75,
            'normalPvpHzUnderOptimizedP2P': 85,
            'conditionalMacros': ['DOWN_FRAME_TEST overrides the constants with NUM_TEST_FRAME.',
                'OPTIMIZED_P2P is defined in the KTDX.h _FOREIGN_ branch.',
                'CHANGE_KEY_DEVICE is defined in the KTDX.h X2TOOL branch; both scheduler branches use constant steps.'],
            'target2016BuildSelectionConfirmed': False},
        'interpretation': ['DXUT callback forwards fElapsedTime into App.OnFrameMove.',
            'Game.OnFrameMove receives/stores its supplied fElapsedTime and forwards it to units.',
            'GameUnit.OnFrameMove receives/stores that delta and passes it to physics.',
            'App ignores the DXUT callback delta for stage simulation; both scheduler branches call FrameProcess with a configurable constant step.',
            'FrameProcess passes that constant step (or slow-factor-scaled step) to active stages; bStop can zero the first argument in the CHANGE_KEY_DEVICE branch.',
            'The pinned normal reference initializes at 85 Hz, sets 75 Hz on StateChange, then conditionally sets 85 Hz for OPTIMIZED_P2P PvP.',
            'Target VIDEO_FPS=30/INDEX=3/VERTICALSYNC=0 are static video-option fields, not verified logical simulation frequencies.'],
        'limits': ['The missing pinned-V5 producer gap is closed; target2016 build macros and logical clock remain unverified.',
            'A pinned-source conditional 75/85 Hz setting is not a target2016 measured cadence or hit expectation.',
            'Changing current simulation step is a sensitivity probe, not authorization to replace the published tick rate.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = build()
    output = ROOT / 'contracts/rf-down-hit-rate-source-v16.json'
    if args.check:
        if json.loads(output.read_bytes()) != data:
            raise ValueError('Actual delta/video source contract drift')
    else:
        output.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'check': args.check, 'sourceFiles': len(data['sourceFiles']),
                      'targetVideoOptions': data['targetVideoOptions']['fields'], 'logicalRateConfirmed': False}))
