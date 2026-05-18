// Production firmware tunables.
//
// All timings, brightnesses, and thresholds are constexpr so retuning
// the experience never requires touching logic code. Defaults are the
// values from the approved plan; expect BLOW_THRESHOLD_ADC and
// BLOW_DWELL_MS to need on-hardware adjustment.

#pragma once

#include <stdint.h>

// -- Boot "capture" on bank 0 ---------------------------------------------
constexpr uint16_t BOOT_RAMP_UP_MS      = 900;
constexpr uint16_t BOOT_DIP_DOWN_MS     = 120;
constexpr uint16_t BOOT_DIP_RECOVER_MS  = 120;
constexpr uint8_t  BOOT_DIP_DUTY        = 35;   // % brightness at the dip
constexpr uint8_t  BOOT_PEAK_DUTY       = 100;
constexpr uint16_t BOOT_HOLD_MS         = 400;

// Pause after the boot capture before the walk starts.
constexpr uint16_t POST_BOOT_PAUSE_MS   = 250;

// -- Ducky walk across banks 0..3 (stop-motion) ---------------------------
// Dwell times eased: short, long, short, then a brief hold on frame 4.
constexpr uint16_t WALK_DWELL_MS[4]     = {180, 380, 280, 180};

// Pause after the walk before the lottery begins.
constexpr uint16_t POST_WALK_PAUSE_MS   = 250;

// -- Lottery spin across banks 4, 5, 6, 7+8 -------------------------------
constexpr uint8_t  LOTTERY_CYCLES       = 10;
constexpr uint16_t LOTTERY_DWELL_MS[LOTTERY_CYCLES] =
    {60, 50, 45, 40, 45, 55, 70, 90, 120, 160};
// Dead beat between the last lottery cycle and the reveal.
constexpr uint16_t LOTTERY_PAUSE_MS     = 300;

// -- Reveal: great luck (blinks + symmetric outward ripple + hold) -------
// Total scene ~= 3*(BLINK_ON+OFF) + GREAT_RIPPLE_CYCLES*(MAX_DIST+2)*STEP
//             + GREAT_HOLD_SECONDS*1000 ~= 15 s.
constexpr uint8_t  GREAT_BLINK_COUNT    = 3;
constexpr uint16_t BLINK_ON_MS          = 80;
constexpr uint16_t BLINK_OFF_MS         = 80;
constexpr uint16_t GREAT_RIPPLE_STEP_MS = 80;
constexpr uint8_t  GREAT_RIPPLE_CYCLES  = 5;
constexpr uint8_t  GREAT_RIPPLE_PEAK    = 100;
constexpr uint8_t  GREAT_HOLD_SECONDS   = 12;

// -- Reveal: little luck (bounded random-walk hiccup on bank 5 only) -----
// Subtle "neon-sign jitter": brightness wanders in [LOW, HIGH] with a
// small per-step delta. Never goes dark; doesn't touch nearby banks.
constexpr uint8_t  LITTLE_HICCUP_LOW      = 75;
constexpr uint8_t  LITTLE_HICCUP_HIGH     = 100;
constexpr uint16_t LITTLE_HICCUP_STEP_MS  = 40;
constexpr uint32_t LITTLE_HICCUP_TOTAL_MS = 15000;

// -- Reveal: uncertain luck (breathing) -----------------------------------
constexpr uint16_t BREATHE_RAMP_MS      = 1200;
constexpr uint16_t BREATHE_PERIOD_MS    = 1800;
constexpr uint8_t  BREATHE_LOW_DUTY     = 35;
constexpr uint8_t  BREATHE_HIGH_DUTY    = 100;
// Total wall-clock for uncertain reveal (matches the 15 s budget).
constexpr uint16_t UNCERTAIN_TOTAL_MS   = 15000;

// -- Reveal: bad luck (fire) ----------------------------------------------
// Candle-flicker frame rate (commercial flicker LEDs run ~14 Hz).
constexpr uint16_t FLAME_FRAME_MS       = 70;
// Brightness range: never goes below this, never rises above this.
// Floor at ~30 % keeps the flame visibly "alive" between flickers.
constexpr uint8_t  FLAME_FLOOR_DUTY     = 30;
constexpr uint8_t  FLAME_CEIL_DUTY      = 100;
// Per-millisecond approach toward the current target duty. Higher =
// crisper flicker, lower = more molten-looking. 3 looks like real fire.
constexpr uint8_t  FLAME_INTERP_STEP    = 3;
// Cross-coupling chance (out of 256). When a new orange target is
// chosen, with this probability the red target is nudged the same way.
constexpr uint8_t  FLAME_GUST_CHANCE    = 64;   // 25 %

// -- Blow-out detector ----------------------------------------------------
// Raw |sample - dc| must stay above this for BLOW_DWELL_MS continuous
// (tolerating up to BLOW_GAP_MS of below-threshold between loud samples
// so AC zero-crossings don't reset the streak). The envelope's
// peak-and-decay shape would let a single clap mimic a long blow, so
// the detector uses raw samples instead.
constexpr int16_t  BLOW_THRESHOLD_ADC   = 120;
constexpr uint16_t BLOW_DWELL_MS        = 100;
constexpr uint16_t BLOW_GAP_MS          = 20;
// After this long without a blow, the fire times out and the card
// goes to sleep anyway -- prevents face-down-in-a-drawer drain.
constexpr uint32_t FIRE_TIMEOUT_MS      = 60000;
// Flare-up + fade animation after a successful blow.
constexpr uint16_t FLARE_UP_MS          = 80;
constexpr uint16_t FLARE_FADE_MS        = 220;
// Fade-out used on fire timeout (no blow) -- a slower, sadder die.
constexpr uint16_t FIRE_TIMEOUT_FADE_MS = 600;

// -- RNG ------------------------------------------------------------------
// Number of ADC samples folded into the initial seed at boot.
constexpr uint8_t  RNG_SEED_SAMPLES     = 64;
// Number of samples folded in before the lottery draw (re-seed).
constexpr uint8_t  RNG_RESEED_SAMPLES   = 32;

// -- Development override (set to 0..3 to force a fortune for tuning) -----
// 0 = great, 1 = little, 2 = uncertain, 3 = bad. -1 = use real RNG.
#ifndef FORCE_FORTUNE
#define FORCE_FORTUNE (-1)
#endif
