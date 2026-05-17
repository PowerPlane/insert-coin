// xorshift32 PRNG, hardware-seeded from ADC1 LSB noise on the mic pin.
//
// Per published characterizations of AVR ADCs, even a "biased" input
// like the mic at VCC/2 carries ~3 bits of true noise per 10-bit
// sample. Folding 32-64 such samples into the seed gives well over
// 32 bits of entropy -- more than enough to make a 4-way fortune
// pick indistinguishable from uniform.

#pragma once

#include <stdint.h>

// Harvest n ADC samples (blocking) and fold their LSBs into the seed.
// mic_init() must have run first.
void rng_seed_from_mic(uint8_t n);

// xorshift32 next() -- never returns 0.
uint32_t rng_next();

// Pick uniformly from 0..(n-1). n must be > 0. Uses rejection to avoid
// modulo bias when n is not a power of two (here n=4 so it's a no-op,
// but the general form is cheap and future-proof).
uint8_t rng_range(uint8_t n);
