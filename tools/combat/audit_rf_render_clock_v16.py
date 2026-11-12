"""Read-only pinned-source simulation/render coupling audit; no target2016 cadence inference."""
import argparse
import json
from pathlib import Path
from audit_rf_hit_sources_v14 import ROOT, REFERENCE, file_evidence
from audit_rf_down_rate_sources_v16 import line_span


SOURCES = {
    '.cache/clock-source-v16/KTDXLIB/KTDXApp.cpp': ('KTDXLIB/KTDXApp.cpp', [
        (599, 601, ['m_bFirstFrame = true']),
        (763, 786, ['m_StopFrameDelay--', 'm_StopFrame--', 'm_bFinalFrame = true', 'FrameProcess()']),
        (792, 835, ['while( fRealElapsedTime > m_fConstElapsedTime )', 'm_bFinalFrame = false',
                    'X2OPTIMIZE_SIMULATION_LAG_LIMIT', 'm_bOneSimulOneRender']),
        (1101, 1145, ['m_RenderCount++', 'pCKTDXStage->OnFrameRender()'])]),
    '.cache/native-source-runtime/KTDXLIB/KTDX.h': ('KTDXLIB/KTDX.h', [
        (262, 265, ['#define\tX2OPTIMIZE_INFORM_FIRST_FRAME_OF_SIMULATION_LOOP', '#define X2OPTIMIZE_SIMULATION_LAG_LIMIT']),
        (328, 342, ['#define X2OPTIMIZE_PARTICLE_AND_ETC_SIMULATION', '#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE']),
        (454, 454, ['//#define X2OPTIMIZE_ONE_SIMUL_ONE_RENDER_TEST'])]),
    '.cache/native-source-runtime/KTDXLIB/KTDXApp.h': ('KTDXLIB/KTDXApp.h', [
        (501, 507, ['IsFinalFrameOfSimulationLoop()', 'm_bFinalFrame'])]),
    '.cache/native-source-runtime/X2/X2.cpp': ('X2/X2.cpp', [
        (1376, 1385, ['g_pKTDXApp->OnFrameMove( fTime, fElapsedTime )']),
        (1394, 1427, ['BeginScene()', 'g_pKTDXApp->OnFrameRender()'])]),
    '.cache/native-reference/X2Lib/X2Game.cpp': ('X2Lib/X2Game.cpp', [
        (2658, 2662, ['m_iPacketSendFrameMoveCount++', 'GetFrameBufferNum()']),
        (2695, 2724, ['m_AllowFrameCount--', 'KeyProcess()']),
        (2844, 2858, ['IsFirstFrameOfSimulationLoop()', 'AddUserUnitIntruder']),
        (3003, 3032, ['GUT_USER', 'GUT_NPC', 'pCX2GameUnit->OnFrameMove( fTime, fElapsedTime )']),
        (3160, 3168, ['m_pDamageEffect->OnFrameMove( fTime, fElapsedTime )']),
        (3600, 3625, ['ObjectChainNonAlphaRender()', 'ObjectChainAlphaRender()'])]),
    '.cache/native-reference/X2Lib/X2GUUser.cpp': ('X2Lib/X2GUUser.cpp', [
        (6491, 6527, ['DoFrameMoveFuture()', 'CommonFrameMoveFuture()', 'DoFrameMove()', 'CommonFrameMove()']),
        (6742, 6799, ['IsLocalUnit()', 'DoFrameMoveFuture()', 'PushFrameData(']),
        (6801, 6851, ['PopFrameData(', 'DoStateEndStart()', 'DoFrameMove()', 'while( m_bPopAgain == true )']),
        (15787, 15801, ['m_bPopAgain == false', 'm_pXSkinAnim->OnFrameMove', 'm_AdvanceTimeCount']),
        (17868, 17882, ['CommonFrameMoveForUser', 'CommonFrameMove_TimedEvent()']),
        (18144, 18159, ['GetNowAnimationTime() > attackTime.x', 'DamageCheck( &m_DamageData )']),
        (21595, 21624, ['m_ReceiveSyncDataList.erase', 'm_FrameBufferNum * 2', 'bPopAgain = true']),
        (21653, 21659, ['bFrameBufferPass = true'])]),
    '.cache/native-reference/KTDXLIB/KTDGXSkinAnim.cpp': ('KTDXLIB/KTDGXSkinAnim.cpp', [
        (650, 689, ['GetCloneFrame', 'm_pCombineMatrix', 'm_pCombineMatrixLineEnd']),
        (758, 774, ['OnFrameMove(', 'UpdateAnimationFrameStructure(']),
        (883, 895, ['OnFrameRender_Draw()', 'CopyModelFrameStructure()'])]),
    '.cache/native-reference/KTDXLIB/KTDGXSkinAnim.h': ('KTDXLIB/KTDGXSkinAnim.h', [
        (380, 435, ['AdvanceTime(', 'td.Position', 'UpdateAnimationFrame(']),
        (628, 654, ['pFrame->combineMatrix = *m_FrameMatrixList[j]'])]),
    '.cache/native-reference/KTDXLIB/KTDGXMeshPlayer.cpp': ('KTDXLIB/KTDGXMeshPlayer.cpp', [
        (1573, 1594, ['m_fAccumElapsedTime += fElapsedTime', 'IsFinalFrameOfSimulationLoop()', 'm_bPerFrameSimulation == false'])]),
    '.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp': ('KTDXLIB/KTDGParticleSystem.cpp', [
        (2939, 2953, ['m_fAccumElapsedTime += fElapsedTime', 'IsFinalFrameOfSimulationLoop()', 'm_bPerFrameSimulation == false'])]),
    '.cache/native-reference/X2Lib/X2DamageEffect.cpp': ('X2Lib/X2DamageEffect.cpp', [
        (1413, 1428, ['pMeshInst->SetPerFrameSimulation( true )']),
        (2358, 2378, ['m_AttackTime.x <= pMeshInst->GetGlobalTime()', 'GetNowAnimationTime()', 'DamageCheck('])]),
    '.cache/native-reference/X2Lib/X2DamageManager.cpp': ('X2Lib/X2DamageManager.cpp', [
        (586, 626, ['AT_UNIT', 'UnitToUnit(', 'AT_EFFECT', 'AT_MESH']),
        (1442, 1448, ['GetCollisionListSet()', 'CollisionDataCheckFromUnitToUnit('])]),
}


def build():
    index_path = Path('asset_sources/upstream/reports/compatibility/v5-tree.json')
    index = {row['path']: row['git_blob'] for row in json.loads(index_path.read_bytes())}
    files = []
    for relative, (repository_relative, spans) in SOURCES.items():
        path = ROOT / relative
        entry = file_evidence(path, relative)
        full = 'JP_TW_EU_CN_US/Trunk/' + repository_relative
        if index[full] != entry['gitBlob']:
            raise ValueError('Fixed tree/source mismatch: ' + full)
        entry.update({'repositoryPath': full,
            'lineSpans': [line_span(path, first, last, tokens) for first, last, tokens in spans]})
        files.append(entry)
    return {'schema': 'rf-render-clock-source-v16', 'referenceCommit': REFERENCE,
        'evidenceClass': 'pinned-V5-static-scheduler-and-consumer-audit',
        'originalClientExecuted': False, 'target2016BuildMacrosConfirmed': False,
        'sourceTreeIndex': file_evidence(index_path), 'sourceFiles': files,
        'observations': [
            'App FinalFrame labels the last fixed step of an OnFrameMove catch-up group, not every fixed step.',
            'Ordinary mesh/particle instances can accumulate dt and skip non-final group steps under the enabled source macros.',
            'DamageEffect main meshes explicitly select PerFrameSimulation=true under the same macro.',
            'Player Future and Now are reached from Game OnFrameMove, not Game OnFrameRender.',
            'Player Now can consume multiple sync frames; skin animation advances only when m_bPopAgain=false, independent of App FinalFrame.',
            'Player TimedEvent DamageCheck reads current skin animation time and clone-linked helper matrices; no direct FinalFrame/render-count gate is present in the read path.',
            'Render draw copies clone pose to shared model frames; it is not the read source of the clone-linked helper matrices.',
            'StopFrame/Delay, input allow count, packet batching and sync-buffer backlog contain count-based rather than solely dt-based consumers.',
            'Lag-limit can discard catch-up debt; the one-simulation-one-render test is commented out in the read KTDX.h.'],
        'limits': [
            'A fixed delta does not prove all computations are independent of render scheduling, frame counts or input/network sampling.',
            'The cached-source read does not establish that all calculations depend on measured display FPS.',
            'Queue-final player animation advance is not a render-final DamageCheck restriction.',
            'No full DXUT outer-loop/frame-limit/vsync consumer was audited in this bounded pass.',
            'Fixed V5 macros and current conditional code are not verified target2016 build choices or behavior.',
            'The parent-provided 2023 official Q&A is later-version evidence; no first-introduction date or target2016 logical cadence follows from it.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = build()
    output = ROOT / 'contracts/rf-render-clock-source-v16.json'
    if args.check:
        if json.loads(output.read_bytes()) != data:
            raise ValueError('Actual render-clock source contract drift')
    else:
        output.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'check': args.check, 'verifiedPinnedFiles': len(data['sourceFiles']),
        'target2016BuildMacrosConfirmed': False}))
