// Scripted animations for the fortune-telling sequence.
//
// Run them in order from setup(): boot_capture -> ducky_walk -> lottery
// -> run_reveal(lottery_result). Each function is blocking; the entire
// show is a single forward pass with no loops at this layer.

#pragma once

#include <stdint.h>

// Bank 0 ramps up, dips, recovers, holds at full. Ends with bank 0 lit.
void anim_boot_capture();

// Stop-motion left-to-right across banks 0..3 with eased dwell.
// Ends with everything off.
void anim_ducky_walk();

// Slot-machine spin across banks 4, 5, 6, 7+8 with accelerating-then-
// decelerating dwell. Re-seeds the RNG from a fresh mic burst at the
// end and returns the chosen fortune index (0 = great, 1 = little,
// 2 = uncertain, 3 = bad).
uint8_t anim_lottery();

// Dispatch to the per-fortune reveal animation.
void anim_run_reveal(uint8_t fortune);
