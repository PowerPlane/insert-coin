// LED cathode-bank driver primitives.
//
// "Bank" indices 0..NUM_BANKS-1 are defined in pins.h.

#pragma once

#include <Arduino.h>
#include <stdint.h>

#include "pins.h"  // NUM_BANKS

void bank_init();

// Drive one bank on/off.
void bank_set(uint8_t idx, bool on);

// Drive all banks at once. Bit i of mask -> bank i.
// Single read-modify-write per PORT; safe to call at PWM tick rates.
void bank_all_mask(uint16_t mask);

inline void bank_all_off() { bank_all_mask(0); }
inline void bank_all_on()  { bank_all_mask((1u << NUM_BANKS) - 1u); }
