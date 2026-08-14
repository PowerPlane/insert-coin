// Production firmware tunables.
//
// All timings, brightnesses, and thresholds are constexpr so retuning
// the experience never requires touching logic code. Defaults are the
// values from the approved plan; expect BLOW_THRESHOLD_ADC and
// BLOW_DWELL_MS to need on-hardware adjustment.

#pragma once

#include <stdint.h>

#include "sleepy.h"  // sleep_seconds_t, for the static_assert below

// -- Boot "capture" on bank 0 ---------------------------------------------
constexpr uint16_t BOOT_RAMP_UP_MS = 900;
constexpr uint16_t BOOT_DIP_DOWN_MS = 120;
constexpr uint16_t BOOT_DIP_RECOVER_MS = 120;
constexpr uint8_t BOOT_DIP_DUTY = 35; // % brightness at the dip
constexpr uint8_t BOOT_PEAK_DUTY = 100;
constexpr uint16_t BOOT_HOLD_MS = 400;

// Pause after the boot capture before the walk starts.
constexpr uint16_t POST_BOOT_PAUSE_MS = 250;

// -- Ducky walk across banks 0..3 (stop-motion) ---------------------------
// Dwell times eased: short, long, short, then a brief hold on frame 4.
constexpr uint16_t WALK_DWELL_MS[4] = {180, 380, 280, 180};

// Pause after the walk before the lottery begins.
constexpr uint16_t POST_WALK_PAUSE_MS = 250;

// -- Lottery spin across banks 4, 5, 6, 7+8 -------------------------------
constexpr uint8_t LOTTERY_CYCLES = 10;
constexpr uint16_t LOTTERY_DWELL_MS[LOTTERY_CYCLES] =
    {60, 50, 45, 40, 45, 55, 70, 90, 120, 160};
// Dead beat between the last lottery cycle and the reveal.
constexpr uint16_t LOTTERY_PAUSE_MS = 300;

// -- Reveal: great luck (blinks + symmetric outward ripple + hold) -------
// Total scene ~= 3*(BLINK_ON+OFF) + GREAT_RIPPLE_CYCLES*(MAX_DIST+2)*STEP
//             + GREAT_HOLD_SECONDS*1000 ~= 15 s.
constexpr uint8_t GREAT_BLINK_COUNT = 3;
constexpr uint16_t BLINK_ON_MS = 80;
constexpr uint16_t BLINK_OFF_MS = 80;
constexpr uint16_t GREAT_RIPPLE_STEP_MS = 80;
constexpr uint8_t GREAT_RIPPLE_CYCLES = 5;
constexpr uint8_t GREAT_RIPPLE_PEAK = 100;
constexpr uint8_t GREAT_HOLD_SECONDS = 12;

// -- Reveal: little luck (asymmetric strobing pulse on bank 5 only) ------
// Slow ease-in to peak (anticipation), snap ease-out to a dim floor
// (the "strobe hit"), brief dim hold, repeat. ~3 pulses / sec for the
// LITTLE_PULSE_ACTIVE_MS active stretch, then a sleep-latched bright
// hold for the rest of the reveal budget -- same handoff shape as
// great-luck so the CPU isn't pinned at 10 MHz.
constexpr uint8_t LITTLE_PULSE_LOW = 15; // dim floor (never dark)
constexpr uint8_t LITTLE_PULSE_HIGH = 100;
constexpr uint16_t LITTLE_PULSE_RISE_MS = 250; // slow ease-in
constexpr uint16_t LITTLE_PULSE_FALL_MS = 50;  // snap ease-out
constexpr uint16_t LITTLE_PULSE_DIM_MS = 50;   // brief hold at floor
constexpr uint16_t LITTLE_PULSE_ACTIVE_MS = 3000;
constexpr uint16_t LITTLE_PULSE_SETTLE_MS = 100;
constexpr uint8_t LITTLE_HOLD_SECONDS = 12;

// -- Reveal: uncertain luck (breathing) -----------------------------------
// Widened range (15 %, was 35 %) for a more dramatic breath; same 1.8 s
// period so the pacing feels the same, just deeper.
constexpr uint16_t BREATHE_RAMP_MS = 1200;
constexpr uint16_t BREATHE_PERIOD_MS = 1800;
constexpr uint8_t BREATHE_LOW_DUTY = 15;
constexpr uint8_t BREATHE_HIGH_DUTY = 100;
// Total wall-clock for uncertain reveal (matches the 15 s budget).
constexpr uint16_t UNCERTAIN_TOTAL_MS = 15000;

// -- Reveal: bad luck (fire) ----------------------------------------------
// Candle-flicker frame rate (commercial flicker LEDs run ~14 Hz).
constexpr uint16_t FLAME_FRAME_MS = 70;
// Brightness range: never goes below this, never rises above this.
// Floor at ~30 % keeps the flame visibly "alive" between flickers.
constexpr uint8_t FLAME_FLOOR_DUTY = 30;
constexpr uint8_t FLAME_CEIL_DUTY = 100;
// Per-millisecond approach toward the current target duty. Higher =
// crisper flicker, lower = more molten-looking. 3 looks like real fire.
constexpr uint8_t FLAME_INTERP_STEP = 3;
// Cross-coupling chance (out of 256). When a new orange target is
// chosen, with this probability the red target is nudged the same way.
constexpr uint8_t FLAME_GUST_CHANCE = 64; // 25 %

// -- Blow-out detector ----------------------------------------------------
// Raw |sample - dc| must stay above this for BLOW_DWELL_MS continuous
// (tolerating up to BLOW_GAP_MS of below-threshold between loud samples
// so AC zero-crossings don't reset the streak). The envelope's
// peak-and-decay shape would let a single clap mimic a long blow, so
// the detector uses raw samples instead.
constexpr int16_t BLOW_THRESHOLD_ADC = 100;
constexpr uint16_t BLOW_DWELL_MS = 100;
constexpr uint16_t BLOW_GAP_MS = 20;
// ── The four-blow claim gesture ──────────────────────────────────────────
//
// Blowing four times, with the battery in, is proof somebody physically
// holds the card. A tap is not: anyone can tap a card across a table, and
// everything in the URL is typed text.
//
// The window is not a flat ten seconds. Only a person already blowing is
// claiming, so it closes after CLAIM_FIRST_BLOW_MS if nothing arrives and
// opens out to CLAIM_WINDOW_MS once the first blow lands. That gives the
// keeper their window and hands the ordinary visitor their boot back.
constexpr uint8_t CLAIM_BLOWS = 4;
// How long an unclaimed boot waits before deciding nobody is blowing.
constexpr uint16_t CLAIM_FIRST_BLOW_MS = 2500;
// Having started, this long without another blow means they stopped.
constexpr uint16_t CLAIM_BETWEEN_BLOWS_MS = 3000;
// A ceiling regardless, so a noisy room cannot hold the card here.
constexpr uint16_t CLAIM_WINDOW_MS = 10000;
// The envelope must fall for this long before the next blow counts, or one
// long breath reads as four and the gesture proves nothing.
constexpr uint16_t CLAIM_GAP_MS = 120;

// How many further attempts to retire an armed claim, backing off 1, 2, 4,
// 8, 16, 32 s. A stale fortune is a small loss; a live claim left on the tag
// is somebody else's setup screen, so this one does not give up early.
constexpr uint8_t CLAIM_DISARM_ROUNDS = 6;

// After this long without a blow, the fire times out and the card
// goes to sleep anyway -- prevents face-down-in-a-drawer drain.
constexpr uint32_t FIRE_TIMEOUT_MS = 60000;
// Flare-up before the air-ripple kicks off on a successful blow.
constexpr uint16_t FLARE_UP_MS = 80;
// Air-ripple propagates from fire (banks 7+8) one bank inward per step
// toward bank 0 -- ~7 steps total. 80 ms / step reads as "rush of air".
constexpr uint16_t BLOW_RIPPLE_STEP_MS = 80;
// Fade-out used on fire timeout (no blow) -- a slower, sadder die.
constexpr uint16_t FIRE_TIMEOUT_FADE_MS = 600;

// -- RNG ------------------------------------------------------------------
// Number of ADC samples folded into the initial seed at boot.
constexpr uint8_t RNG_SEED_SAMPLES = 64;
// Number of samples folded in before the lottery draw (re-seed).
constexpr uint8_t RNG_RESEED_SAMPLES = 32;

// -- Development override (set to 0..3 to force a fortune for tuning) -----
// 0 = great, 1 = little, 2 = uncertain, 3 = bad. -1 = use real RNG.
#ifndef FORCE_FORTUNE
#define FORCE_FORTUNE (-1)
#endif

// -- NFC NDEF record -------------------------------------------------------
// The card WRITES ITS OWN RECORD on first boot, from its own SIGROW serial.
// It used to be pre-programmed by a phone tag-writer app, with the MCU
// patching only the fortune digit — which meant the layout lived in two
// places, a comment here and whatever somebody typed into an app, joined by
// the magic number below. Getting it wrong patches the wrong byte and the
// card serves a broken URL for the rest of its life.
//
// The layout now has ONE definition, in
// shared/firmware/card-identity/ndef_record.h, where every offset is
// derived from the strings at compile time. See docs/pond/PROVISIONING.md.
//
//   0x0000 CC (E1 40 40 00)
//   0x0004 TLV header (03 3D)
//   0x0006 NDEF record header (D1 01 39 55)
//   0x000A URI prefix (0x04 = "https://")
//   0x000B "ducky.davidyang.work/?d="      (24 bytes)
//   0x0023 digit ASCII byte                <-- the ONE patch target
//   0x0024 "&c=" + 8-character serial      (11 bytes)
//   0x002F "&g=" + 4 hex claim counter     (7 bytes)
//   0x0036 "&t=" + 10 hex claim token      (13 bytes)
//   0x0043 Terminator TLV (FE)
//
// 68 bytes in total. At NDEF_EEPROM_WRITE_MS per byte that is ~408 ms of
// first-boot write, once, and it is the number the bench check in
// PROVISIONING.md is confirming fits inside the boot window.
//
// `&c=`, `&g=` and `&t=` all sit AFTER the digit, so the patch target never
// moves and every card still runs one identical binary.
//
// This constant is checked against the derived one two ways: a native test
// in shared/firmware/card-identity (100 checks, run with cc) and a test in
// pond/ that greps this very line. It cannot drift silently any more.
constexpr uint16_t NDEF_DIGIT_OFFSET = 0x0023;

// Internal pull-ups (~35 kOhm) + ~25 pF bus capacitance gives ~2 us
// rise; 25 kHz SCL keeps the data window comfortable without needing
// external resistors on PB0/PB1.
constexpr uint32_t NFC_I2C_CLOCK_HZ = 25000;

// EEPROM single-byte write cycle (datasheet ~5 ms worst case).
constexpr uint8_t NDEF_EEPROM_WRITE_MS = 6;

// An RF field wins arbitration against I2C on the ST25DV, so a phone
// already resting on the card can make the patch NACK. production-nfc
// ignores that return value, which silently serves the PREVIOUS
// visitor's fortune. Retry a few times before giving up.
constexpr uint8_t NDEF_WRITE_ATTEMPTS = 4;
constexpr uint8_t NDEF_RETRY_GAP_MS = 12;

// The reset-to-'0' before terminal sleep is the one write that must not be
// best-effort. Failing it leaves the card advertising a fortune with nothing
// left awake to clear it, so the next person to tap claims a duck they
// didn't earn. Each round is NDEF_WRITE_ATTEMPTS internally, with a 1 s nap
// between rounds to give a resting phone time to move off the antenna.
constexpr uint8_t NDEF_CLEAR_ROUNDS = 5;

// After the reveal, the fortune-coded URL stays live for this many
// seconds, then the MCU wakes once to reset the digit to '0' (no
// ducky) and deep-sleeps for good.
//
// NOTE: 16-bit on purpose. production-nfc declares this uint8_t and
// sleep_timed_seconds() takes a uint8_t, so anything above 255 wraps --
// 300 would become 44 s, i.e. a SHORTER live window than the 120 s it
// replaced, presenting as flaky NFC rather than as an obvious bug.
// sleepy.cpp in this variant widens the parameter and its tick counter
// to match.
constexpr uint16_t NDEF_EXPIRY_SECONDS = 300;

// The guard for the bug above. sleep_seconds_t comes from sleepy.h; if
// either it or NDEF_EXPIRY_SECONDS is ever narrowed, this fails to
// compile rather than quietly shortening the live window.
static_assert(NDEF_EXPIRY_SECONDS <= static_cast<sleep_seconds_t>(-1),
              "NDEF_EXPIRY_SECONDS does not fit sleep_seconds_t -- widen "
              "sleep_seconds_t in sleepy.h before raising this value");
