import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('fx_matrix_probe', ROOT / 'tools/native/check_rf_fx_matrix_source_v19.py')
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
MATRIX = ROOT / '.cache/matrix-source-v18/KTDGMatrix.cpp'
PARTICLE = ROOT / '.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp'


class MatrixSourcePinTests(unittest.TestCase):
    def test_complete_consumers_keep_native_branches_and_return(self):
        matrix = PROBE.pinned(MATRIX, PROBE.MATRIX_PIN)
        body = PROBE.function(matrix, 'const D3DXMATRIX& CKTDGMatrix::GetMatrix(')
        for branch in ['BT_NONE', 'BT_ALL', 'BT_X', 'BT_Y', 'BT_Z']:
            self.assertIn('case ' + branch + ':', body)
        self.assertIn('return m_MatrixSet.m_FinalMatrix;', body)
        self.assertIn('m_MatrixSet.m_ScalingMatrix * m_MatrixSet.m_RotationMatrix * matbill * m_MatrixSet.m_TranslationMatrix', body)
        rotate = PROBE.function(PROBE.pinned(PARTICLE, PROBE.PARTICLE_PIN),
                                'void CKTDGParticleSystem::CParticleEvent_Rotate::OnFrameMove(')
        self.assertIn('GetEventTimerOld()', rotate)
        self.assertIn('part.SetRotateFinal( m_Rotate.GetRandomNumInRange() )', rotate)
        self.assertIn('m_ActualTime.m_Max <= fNew', rotate)

    def test_truncation_or_modified_rotation_is_rejected_before_compile(self):
        original = MATRIX.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Matrix.cpp'
            for data in [original[:-1], original.replace(b'matView._21', b'matView._12', 1)]:
                path.write_bytes(data)
                with self.assertRaisesRegex(ValueError, 'Source hash mismatch'):
                    PROBE.pinned(path, PROBE.MATRIX_PIN)


if __name__ == '__main__':
    unittest.main()
