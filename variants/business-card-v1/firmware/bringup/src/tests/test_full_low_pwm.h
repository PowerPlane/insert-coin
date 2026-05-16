#pragma once

// Light all 9 banks simultaneously at FULL_PWM_DUTY_PCT software PWM.
// At 8 % duty over 24 LEDs the average is ~38 mA; survivable from a
// CR2032 with BOD disabled but bench supply recommended for sustained
// runs.

namespace test_full_low_pwm {

// One PWM period at FULL_PWM_TICK_HZ. Returns to all-off if duty == 0.
void step_once();

[[noreturn]] void run();

}  // namespace test_full_low_pwm
