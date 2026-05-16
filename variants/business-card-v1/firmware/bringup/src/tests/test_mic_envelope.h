#pragma once

// Free-run ADC0 on AIN6 (PC0), compute a peak-and-decay envelope around
// the running DC level, map envelope -> cumulative bank fill (VU meter).
//
// At MIC_FRAME_HZ Hz the display refreshes; the ADC reads as fast as the
// loop will pull samples (well over 10 kHz on a 10 MHz CPU).

namespace test_mic_envelope {

void init();

// One frame: pulls samples, updates the envelope, refreshes the display.
void step_once();

[[noreturn]] void run();

}  // namespace test_mic_envelope
