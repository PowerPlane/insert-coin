#pragma once

// Mic-driven brightness modulation: all 9 banks lit simultaneously,
// software-PWM duty proportional to the running mic envelope.
//
//   loud  -> duty 100 % (full brightness)
//   quiet -> duty MIC_BRIGHTNESS_FLOOR (a faint glow, so the test is
//            visibly "running" even in silence)
//
// Different from test 3 (VU meter): that one chooses *which* banks
// to light based on volume. This one lights *all* banks always, and
// modulates the brightness instead.

namespace test_mic_brightness {

[[noreturn]] void run();

}  // namespace test_mic_brightness
