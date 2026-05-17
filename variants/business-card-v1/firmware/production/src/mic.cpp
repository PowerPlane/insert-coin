#include "mic.h"

#include <Arduino.h>

#include "config.h"
#include "pins.h"

// DC bias tracker seeded from the first sample. The ZTS6156 biases
// somewhat above mid-rail, and the EMA `>>7` update stalls if the
// initial gap to a hardcoded center is < 128 -- see bringup
// test_mic_envelope.cpp:18 for the same fix.
static int16_t  s_dc_ema   = -1;

// Peak-and-decay envelope -- kept available for diagnostics/visuals,
// not used by the blow detector.
static int16_t  s_envelope = 0;

// Raw-sample blow streak. last_loud_ms is the most recent above-
// threshold sample; blow_start_ms is when the current streak started.
// Tolerating BLOW_GAP_MS of quiet between loud samples means AC
// zero-crossings don't reset the streak, but a clap dies fast.
static uint32_t s_last_loud_ms  = 0;
static uint32_t s_blow_start_ms = 0;
static bool     s_blow_active   = false;

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
    s_blow_active = false;
}

void mic_deinit() {
    MIC_ADC.CTRLA &= ~ADC_ENABLE_bm;
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

    if (a > s_envelope) s_envelope = a;
    else if (s_envelope > 0) s_envelope--;

    uint32_t now = millis();
    if (a >= BLOW_THRESHOLD_ADC) {
        if (!s_blow_active) {
            s_blow_active = true;
            s_blow_start_ms = now;
        }
        s_last_loud_ms = now;
    } else if (s_blow_active &&
               (uint32_t)(now - s_last_loud_ms) > BLOW_GAP_MS) {
        s_blow_active = false;
    }
    return true;
}

int16_t mic_envelope() {
    return s_envelope;
}

void mic_blow_reset() {
    s_blow_active = false;
}

bool mic_blow_detected() {
    if (!s_blow_active) return false;
    return (uint32_t)(millis() - s_blow_start_ms) >= BLOW_DWELL_MS;
}
