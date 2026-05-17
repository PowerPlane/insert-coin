// Microphone: free-running ADC1 on PC0, peak-and-decay envelope, and a
// debounced blow detector.
//
// init() once. Then either:
//   - pump_sample() opportunistically (no busy-wait; returns true if a
//     fresh sample was folded in). Use this from inside the flame loop
//     so PWM stays smooth while we listen.
//   - read_raw() / read_raw_blocking() for the RNG seeder.
//
// envelope() reports the current peak-decay value (10-bit ADC units
// above DC). blow_detected() returns true once the envelope has stayed
// above BLOW_THRESHOLD_ADC for BLOW_DWELL_MS continuous.

#pragma once

#include <stdint.h>

void mic_init();

// Blocking read of one ADC sample (~25 us at PRESC/16, 10 MHz CPU).
// Used by the RNG seeder. After mic_init() runs the ADC is free-running.
uint16_t mic_read_raw_blocking();

// Non-blocking: if a fresh sample is ready, fold it into the DC tracker
// and the envelope, and return true. Otherwise return false immediately.
bool mic_pump_sample();

// Current envelope value (ADC LSBs above the running DC bias).
int16_t mic_envelope();

// Reset the blow-debouncer's running timer. Call when entering fire mode
// so prior loud sounds don't auto-extinguish.
void mic_blow_reset();

// True if the envelope has stayed above BLOW_THRESHOLD_ADC for at least
// BLOW_DWELL_MS continuous. Self-resets on each below-threshold sample.
bool mic_blow_detected();
