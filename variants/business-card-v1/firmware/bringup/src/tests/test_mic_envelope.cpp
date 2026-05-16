#include "test_mic_envelope.h"

#include <Arduino.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"

namespace test_mic_envelope {

static constexpr uint16_t FRAME_PERIOD_MS = 1000 / MIC_FRAME_HZ;

// Running estimate of the DC bias of the mic signal (10-bit ADC units).
// Mic is AC-coupled around ~VCC/2 so this should settle near 512.
static int16_t dc_ema = 512;

// Peak-and-decay envelope. Decay by 1 each frame; rises instantly with
// new peaks.
static int16_t env = 0;

void init() {
    // Disable PC0's digital input buffer; the ADC reads the analog pin
    // directly, and a live digital buffer just leaks current and adds
    // switching noise to the sample.
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;

    // Configure MIC_ADC (= ADC1 on this part) for free-running,
    // VREF = VDD, 10-bit.
    MIC_ADC.CTRLA  = ADC_RESSEL_10BIT_gc;
    MIC_ADC.CTRLB  = ADC_SAMPNUM_ACC1_gc;
    MIC_ADC.CTRLC  = ADC_PRESC_DIV16_gc | ADC_REFSEL_VDDREF_gc;
    MIC_ADC.CTRLD  = 0;
    MIC_ADC.MUXPOS = MIC_ADC_MUXPOS;
    MIC_ADC.CTRLA |= ADC_FREERUN_bm | ADC_ENABLE_bm;
    MIC_ADC.COMMAND = ADC_STCONV_bm;  // kick off the first conversion
}

static inline uint16_t adc_read() {
    while (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) { /* spin */ }
    uint16_t v = MIC_ADC.RES;
    MIC_ADC.INTFLAGS = ADC_RESRDY_bm;
    return v;
}

void step_once() {
    uint32_t deadline = millis() + FRAME_PERIOD_MS;

    int16_t peak = 0;
    while ((int32_t)(millis() - deadline) < 0) {
        int16_t x = (int16_t)adc_read();
        // First-order EMA toward DC level (shift 7 ~ tau of ~128 samples).
        dc_ema += (x - dc_ema) >> 7;
        int16_t a = x - dc_ema;
        if (a < 0) a = -a;
        if (a > peak) peak = a;
    }

    // Peak-and-decay: instant rise, decay by 1 unit per frame.
    if (peak > env) env = peak;
    else if (env > 0) env--;

    // VU meter: bank i lit if env > (i+1) * MIC_BANK_STEP.
    uint16_t mask = 0;
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        if (env > (int16_t)((i + 1) * MIC_BANK_STEP)) {
            mask |= (1u << i);
        }
    }
    bank_all_mask(mask);
}

[[noreturn]] void run() {
    init();
    for (;;) {
        step_once();
    }
}

}  // namespace test_mic_envelope
