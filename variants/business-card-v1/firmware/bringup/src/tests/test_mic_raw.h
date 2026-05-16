#pragma once

// Raw ADC indicator -- diagnostic mode for the mic.
//
// Reads the ADC continuously and maps the raw value (0..1023) directly
// to bank fill (0..9 banks). No envelope, no DC tracker, no PWM -- just
// "what is the ADC seeing right now."
//
// Interpretation:
//   0 banks lit (all dark)              ADC reads ~0     -> mic outputs 0 V
//                                                            (dead / unbiased)
//   ~4-5 banks lit, steady              ADC reads ~512   -> mic at VCC/2
//                                                            (healthy bias)
//   9 banks lit (all on)                ADC reads ~1023  -> mic shorted to VCC
//   Bank count wobbles with sound       ADC swings       -> mic is producing
//                                                            AC signal

namespace test_mic_raw {

[[noreturn]] void run();

}  // namespace test_mic_raw
