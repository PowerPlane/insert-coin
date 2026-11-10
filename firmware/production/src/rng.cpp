#include "rng.h"

#include "mic.h"

// Seed must never be 0 (xorshift32 fixpoint at 0). Initialized to a
// non-zero constant; rng_seed_from_mic() XORs entropy in.
static uint32_t s_state = 0x9E3779B9u;  // golden-ratio constant, != 0

void rng_seed_from_mic(uint8_t n) {
    for (uint8_t i = 0; i < n; i++) {
        uint32_t s = mic_read_raw_blocking();
        // Fold 4 LSBs in -- the higher bits are mostly DC + signal, the
        // bottom few are ADC noise. Rotate the accumulator each round so
        // bits land in different positions.
        s_state ^= (s & 0xF) << ((i & 7) * 4);
        s_state = (s_state << 13) | (s_state >> 19);  // rotl 13
    }
    if (s_state == 0) s_state = 0x9E3779B9u;
}

uint32_t rng_next() {
    uint32_t x = s_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s_state = x;
    return x;
}

uint8_t rng_range(uint8_t n) {
    if (n == 0) return 0;
    // Rejection sampling against the largest multiple of n that fits in
    // 32 bits. Cheap and removes modulo bias for any n.
    uint32_t limit = 0xFFFFFFFFu - (0xFFFFFFFFu % n);
    uint32_t r;
    do { r = rng_next(); } while (r >= limit);
    return (uint8_t)(r % n);
}
