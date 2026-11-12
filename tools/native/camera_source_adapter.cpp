// Project-owned platform boundary. Original method bodies are generated into
// ignored .inc files after their fixed Git blob and SHA256 are verified.
// No D3D renderer, camera shake or camera impact is emulated by this adapter.
#include <float.h>

static_assert(sizeof(float) == 4 && __FLT_MANT_DIG__ == 24,
              "The original camera state requires IEEE binary32 floats");

inline double fabs(double value) { return __builtin_fabs(value); }

struct D3DXVECTOR3 {
    float x, y, z;
    D3DXVECTOR3() = default;
    D3DXVECTOR3(float px, float py, float pz) : x(px), y(py), z(pz) {}
};
struct D3DXMATRIX { float unused[16]; };

static unsigned int matrixCalls = 0;
static unsigned int viewCalls = 0;
static unsigned int shakeCalls = 0;
static unsigned int impactCalls = 0;

void D3DXMatrixLookAtLH(D3DXMATRIX*, const D3DXVECTOR3*,
                      const D3DXVECTOR3*, const D3DXVECTOR3*) {
    ++matrixCalls; // Deliberately no matrix calculation: this is the D3D boundary.
}
struct ViewSink {
    void SetViewTransform(const D3DXMATRIX*) { ++viewCalls; }
};
static ViewSink viewSink;
static ViewSink* g_pKTDXApp = &viewSink;

// The fixed Always.h enables this branch; the generator verifies its definition.
#define KEYFRAME_CAMERA
#include "original_camera_math.inc"

class CKTDGCamera {
public:
#include "original_camera_members.inc"
    CameraData m_Camera;
    D3DXVECTOR3 m_Track, m_TrackAt;
    float m_fTrackTime, m_fTrackAtTime;
    bool m_bFixedUpVec;
    UpSideDownCameraData m_UpSideDownCameraData;

    void Point(float, float, float, float, float, float, float, float, float);
    void MoveRel(float, float, float);
    void LookAtRel(float, float, float);
    void SetTracking(float, float, float, float, float, float, float, float);
    void UpdateCamera(float);
    void UpdateCameraShake(float) { ++shakeCalls; }
    void UpdateCameraImpact(float) { ++impactCalls; }
};

#include "original_camera_methods.inc"

static CKTDGCamera sourceCamera;
static float output[22];

static void writeOutput() {
    output[0] = sourceCamera.m_Camera.m_Eye.x;
    output[1] = sourceCamera.m_Camera.m_Eye.y;
    output[2] = sourceCamera.m_Camera.m_Eye.z;
    output[3] = sourceCamera.m_Camera.m_LookAt.x;
    output[4] = sourceCamera.m_Camera.m_LookAt.y;
    output[5] = sourceCamera.m_Camera.m_LookAt.z;
    output[6] = sourceCamera.m_Camera.m_UpVec.x;
    output[7] = sourceCamera.m_Camera.m_UpVec.y;
    output[8] = sourceCamera.m_Camera.m_UpVec.z;
    output[9] = sourceCamera.m_Track.x;
    output[10] = sourceCamera.m_Track.y;
    output[11] = sourceCamera.m_Track.z;
    output[12] = sourceCamera.m_TrackAt.x;
    output[13] = sourceCamera.m_TrackAt.y;
    output[14] = sourceCamera.m_TrackAt.z;
    output[15] = sourceCamera.m_fTrackTime;
    output[16] = sourceCamera.m_fTrackAtTime;
    output[17] = sourceCamera.m_UpSideDownCameraData.m_fTimeLeft;
    output[18] = static_cast<float>(matrixCalls);
    output[19] = static_cast<float>(viewCalls);
    output[20] = static_cast<float>(shakeCalls);
    output[21] = static_cast<float>(impactCalls);
}

extern "C" {
void camera_init(float ex, float ey, float ez, float tx, float ty, float tz,
                 float ux, float uy, float uz) {
    matrixCalls = viewCalls = shakeCalls = impactCalls = 0;
    sourceCamera.m_bFixedUpVec = true;
    sourceCamera.m_Track.x = sourceCamera.m_Track.y = sourceCamera.m_Track.z = 0;
    sourceCamera.m_TrackAt.x = sourceCamera.m_TrackAt.y = sourceCamera.m_TrackAt.z = 0;
    sourceCamera.m_UpSideDownCameraData.m_fTimeLeft = 0;
    sourceCamera.Point(ex, ey, ez, tx, ty, tz, ux, uy, uz);
    writeOutput();
}
void camera_point(float ex, float ey, float ez, float tx, float ty, float tz,
                  float ux, float uy, float uz) {
    sourceCamera.Point(ex, ey, ez, tx, ty, tz, ux, uy, uz);
    writeOutput();
}
void camera_set_tracking(float ex, float ey, float ez, float tx, float ty, float tz,
                         float seconds, float targetSeconds) {
    sourceCamera.SetTracking(ex, ey, ez, tx, ty, tz, seconds, targetSeconds);
    writeOutput();
}
void camera_advance(float seconds) {
    sourceCamera.UpdateCamera(seconds);
    writeOutput();
}
// Presentation bridge: preserve tracking timers/velocities while the source
// MoveRel and LookAtRel consume the checked oscillation increment.
void camera_translate(float x, float y, float z) {
    sourceCamera.MoveRel(x, y, z);
    sourceCamera.LookAtRel(x, y, z);
    writeOutput();
}
// Exposes the original nested data timer only for the isolated source tests.
void camera_test_upside_down(float seconds) {
    sourceCamera.m_UpSideDownCameraData.m_fTimeLeft = seconds;
    writeOutput();
}
const float* camera_output_ptr() { return output; }
unsigned int camera_output_count() { return 22; }
}
