#pragma once

// Scan the I2C bus 0x08..0x77; check for the ST25DV04K at 0x53.
// Result reporting:
//   success: bank 0 blinks at 2 Hz forever
//   failure: bank 8 blinks at 5 Hz forever
//
// The PCB has no external I2C pull-ups -- internal pull-ups on PB0/PB1
// are enabled before Wire.begin().

namespace test_i2c_scan {

[[noreturn]] void run();

}  // namespace test_i2c_scan
