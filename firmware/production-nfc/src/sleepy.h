// Deep-sleep helpers.
//
// sleep_timed_seconds: RTC-PIT-driven SLEEP_MODE_PWR_DOWN for a few
// seconds. GPIO output state survives sleep, so bank MOSFETs stay lit
// while the CPU drops from ~5 mA active to <10 uA -- the big win
// during the 15 s great/little hold.
//
// sleep_forever: terminal. Disables ADCs, kills input buffers, never
// returns. Cold boot is the only exit.

#pragma once

#include <stdint.h>

void sleep_timed_seconds(uint8_t seconds);
[[noreturn]] void sleep_forever();
