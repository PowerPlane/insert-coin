// Sleep helpers.
//
// sleep_timed_seconds: RTC-PIT-driven SLEEP_MODE_PWR_DOWN for a bounded
// number of seconds. Used for the live-URL window between the reveal and
// the reset-to-'0' write.
//
// Differs from the production-nfc copy in one way that matters: the
// parameter and the internal tick counter are 16-bit. The pond variant
// holds the URL live for 300 s, and a uint8_t would wrap that to 44.
//
// sleep_forever: terminal sleep. Pulling the coin is the only restart.

#pragma once

#include <stdint.h>

// Named so config.h can static_assert that NDEF_EXPIRY_SECONDS actually
// fits. Narrowing this back to uint8_t now breaks the build instead of
// silently turning a 300 s window into 44 s.
using sleep_seconds_t = uint16_t;

void sleep_timed_seconds(sleep_seconds_t seconds);

[[noreturn]] void sleep_forever();
