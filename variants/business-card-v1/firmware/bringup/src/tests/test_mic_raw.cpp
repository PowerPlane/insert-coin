#include "test_mic_raw.h"

#include <Arduino.h>

#include "../leds.h"
#include "../pins.h"
#include "test_mic_envelope.h"  // reuse the ADC init()

namespace test_mic_raw {

[[noreturn]] void run() {
    test_mic_envelope::init();

    for (;;) {
        // Wait for an ADC sample.
        while (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) { /* spin */ }
        uint16_t x = MIC_ADC.RES;
        MIC_ADC.INTFLAGS = ADC_RESRDY_bm;

        // Map raw ADC (0..1023) to bank fill (0..9 banks).
        // 1024 / 9 = ~114, so each bank represents ~114 ADC units.
        uint8_t n = x / 114;
        if (n > NUM_BANKS) n = NUM_BANKS;
        uint16_t mask = ((uint16_t)1 << n) - 1;
        bank_all_mask(mask);
    }
}

}  // namespace test_mic_raw
