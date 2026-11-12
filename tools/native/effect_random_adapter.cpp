// Owned ABI/host adapter. Original RandomNumber overloads are included unchanged.
// rand() is an injected Windows-CRT output, not a reimplementation of its state.
static int host_rand_value;
static int rand_calls;
static int rand() { ++rand_calls; return host_rand_value; }
static int abs(int value) { return value < 0 ? -value : value; }
static double fabs(double value) { return __builtin_fabs(value); }
#define RAND_MAX 32767
#include "original_effect_random.inc"

extern "C" {
int er_abi() { return 1; }
int er_rand_max() { return RAND_MAX; }
int er_draws() { return rand_calls; }
float er_float(float min, float max, int rand_value) {
    host_rand_value = rand_value; rand_calls = 0;
    return RandomNumber(min, max);
}
int er_int(int min, int max, int rand_value) {
    host_rand_value = rand_value; rand_calls = 0;
    return RandomNumber(min, max);
}
}

#ifdef EFFECT_RANDOM_NATIVE_HARNESS
#include <stdio.h>
int main() {
    int values[] = {0, 16384, 32767};
    for (int value : values) {
        float f = er_float(.7f, .5f, value);
        int fd = er_draws();
        int i = er_int(7, 2, value);
        printf("%d %.9g %d %d %d\n", value, f, fd, i, er_draws());
    }
    float equal = er_float(.5f, .5f, 32767);
    printf("equal %.9g %d\n", equal, er_draws());
    return equal == .5f && er_draws() == 0 ? 0 : 1;
}
#endif
