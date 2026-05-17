#include "mic.h"

#include <Arduino.h>

#include "config.h"
#include "pins.h"

// DC bias tracker. Seeded from first sample to avoid EMA stall when the
// mic doesn't bias at exactly VCC/2 (the ZTS6156 on this board sits a
// bit above mid-rail). See bringup test_mic_envelope.cpp:18 for the
// same fix.
static int16_t s_dc_ema   = -1;
static int16_t s_envelope = 0;

// Blow debouncer: track when the envelope first crossed up.
static uint32_t s_above_since_ms = 0;
static bool     s_above          = false;

void mic_init() {
    PORTC.PIN0CTRL = PORT_ISC_INPUT_DISABLE_gc;

    MIC_ADC.CTRLA  = ADC_RESSEL_10BIT_gc;
    MIC_ADC.CTRLB  = ADC_SAMPNUM_ACC1_gc;
    MIC_ADC.CTRLC  = ADC_PRESC_DIV16_gc | ADC_REFSEL_VDDREF_gc;
    MIC_ADC.CTRLD  = 0;
    MIC_ADC.MUXPOS = MIC_ADC_MUXPOS;
    MIC_ADC.CTRLA |= ADC_FREERUN_bm | ADC_ENABLE_bm;
    MIC_ADC.COMMAND = ADC_STCONV_bm;

    s_dc_ema = -1;
    s_envelope = 0;
    s_above = false;
}

uint16_t mic_read_raw_blocking() {
    while (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) { /* spin */ }
    uint16_t v = MIC_ADC.RES;
    MIC_ADC.INTFLAGS = ADC_RESRDY_bm;
    return v;
}

bool mic_pump_sample() {
    if (!(MIC_ADC.INTFLAGS & ADC_RESRDY_bm)) return false;
    int16_t x = (int16_t)MIC_ADC.RES;
    MIC_ADC.INTFLAGS = ADC_RESRDY_bm;

    if (s_dc_ema < 0) s_dc_ema = x;
    else              s_dc_ema += (x - s_dc_ema) >> 7;

    int16_t a = x - s_dc_ema;
    if (a < 0) a = -a;

    // Peak-and-decay envelope; rises instantly, decays slowly.
    if (a > s_envelope) {
        s_envelope = a;
    } else if (s_envelope > 0) {
        s_envelope--;
    }
    return true;
}

int16_t mic_envelope() {
    return s_envelope;
}

void mic_blow_reset() {
    s_above = false;
    s_above_since_ms = 0;
}

bool mic_blow_detected() {
    uint32_t now = millis();
    if (s_envelope >= BLOW_THRESHOLD_ADC) {
        if (!s_above) {
            s_above = true;
            s_above_since_ms = now;
            return false;
        }
        return (uint32_t)(now - s_above_since_ms) >= BLOW_DWELL_MS;
    }
    s_above = false;
    return false;
}
