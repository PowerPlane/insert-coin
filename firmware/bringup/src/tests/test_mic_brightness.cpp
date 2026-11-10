#include "test_mic_brightness.h"

#include <Arduino.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"
#include "test_mic_envelope.h"  // reuse the ADC/mic init()

namespace test_mic_brightness {

// PWM cycles per frame -- inner work runs ~1 ms / cycle, so
// MIC_BRIGHTNESS_FRAME_MS cycles gives roughly one envelope update per
// frame. Computed as constexpr so the compiler can hoist it.
static constexpr uint8_t CYCLES_PER_FRAME = MIC_BRIGHTNESS_FRAME_MS;

[[noreturn]] void run() {
    test_mic_envelope::init();

    // Seed dc_ema with a real first ADC sample. The EMA update
    // `dc_ema += (x - dc_ema) >> 7;` only converges when the gap is
    // >= 128 ADC units, so if the mic biases more than ~12 % of VCC
    // away from a hardcoded 512, the EMA gets stuck and the envelope
    // saturates -- pinning duty at 100 %.
    while (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) { /* spin */ }
    int16_t dc_ema = (int16_t)MIC_ADC.RES;
    MIC_ADC.INTFLAGS = ADC_RESRDY_bm;

    int16_t env    = 0;    // peak-and-decay envelope
    uint8_t duty   = 0;    // 0..100, % of PWM cycle banks are lit

    for (;;) {
        int16_t peak = 0;

        // One frame: drive the PWM at ~1 kHz, opportunistically pulling
        // ADC samples between phase transitions to update `peak`.
        for (uint8_t cycle = 0; cycle < CYCLES_PER_FRAME; cycle++) {
            for (uint8_t phase = 0; phase < 100; phase++) {
                // PWM edges -- only fire at the two transitions.
                // duty == 0: both fire on phase 0 (brief on/off blip,
                //   <1 us, eye-invisible) -- effectively off.
                // duty == 100: phase never reaches 100, so the off
                //   transition never fires -- effectively DC.
                if (phase == 0)    bank_all_on();
                if (phase == duty) bank_all_off();

                // Pull a sample if the ADC has one ready.
                if (MIC_ADC.INTFLAGS & ADC_RESRDY_bm) {
                    int16_t x = (int16_t)MIC_ADC.RES;
                    MIC_ADC.INTFLAGS = ADC_RESRDY_bm;
                    dc_ema += (x - dc_ema) >> 7;
                    int16_t a = x - dc_ema;
                    if (a < 0) a = -a;
                    if (a > peak) peak = a;
                }

                delayMicroseconds(MIC_BRIGHTNESS_PWM_STEP_US);
            }
        }

        // End of frame: peak-and-decay envelope, then map env -> duty.
        if (peak > env) env = peak;
        else if (env > 0) env--;

        uint32_t scaled = (uint32_t)env * 100u / MIC_BRIGHTNESS_FULL_AT;
        if (scaled > 100) scaled = 100;
        if (scaled < MIC_BRIGHTNESS_FLOOR) scaled = MIC_BRIGHTNESS_FLOOR;
        duty = (uint8_t)scaled;
    }
}

}  // namespace test_mic_brightness
