// Candle flicker for banks 7 (orange) and 8 (red).
//
// Two streams, ~14 Hz frame rate, biased rejection sampling (~50 % of
// frames at max brightness, lowest levels rarely chosen) per the
// commercial flicker-LED behaviour reverse-engineered by cpldcpu. A
// "gust" cross-coupling occasionally locks red to orange so both LEDs
// surge together, giving the impression of airflow over the flame.
//
// run_until_blow() also pumps the mic envelope, returning early when
// the blow detector fires.

#pragma once

#include <stdint.h>

enum FlameResult : uint8_t {
    FLAME_RESULT_BLOWN   = 0,
    FLAME_RESULT_TIMEOUT = 1,
};

void flame_init();

// One animation step: advance interpolation toward target, write duties.
// Caller drives the PWM ticks.
void flame_tick(uint32_t now_ms);

// Render the flame continuously, pumping the mic, until either the blow
// detector fires or `timeout_ms` elapses.
uint8_t flame_run_until_blow(uint32_t timeout_ms);

// Snapshot of the current rendered brightness on each fire bank --
// needed for a smooth flare-up from the current flicker state, not
// from a hardcoded value.
uint8_t flame_current_orange();
uint8_t flame_current_red();
