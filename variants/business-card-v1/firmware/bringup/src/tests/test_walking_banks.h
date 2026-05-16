#pragma once

// Light each of the 9 LED banks in sequence, WALK_STEP_MS each.
// Verifies every MOSFET, every cathode-bank trace, and (visually) every
// LED solder joint -- a dead LED appears as a "missing dot" in its bank.
//
// Per-LED walking is NOT possible on this PCB: all 24 anodes are tied
// through individual resistors to VCC, so an LED is lit exactly when
// its bank's MOSFET is on.

namespace test_walking_banks {

// One pass through all banks. Returns to all-off when done.
void step_once();

// Owns the main loop; never returns.
[[noreturn]] void run();

}  // namespace test_walking_banks
