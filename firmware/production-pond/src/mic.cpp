#include "mic.h"

#include <Arduino.h>

#include "config.h"
#include "pins.h"

// DC bias tracker seeded from the first sample. The ZTS6156 biases
// somewhat above mid-rail, and the EMA `>>7` update stalls if the
// initial gap to a hardcoded center is < 128 -- see bringup
// test_mic_envelope.cpp:18 for the same fix.
/*
 * The DC tracker, in Q7 fixed point — and the extra seven bits are the
 * whole point.
 *
 * As a plain int16 this was `s_dc_ema += (x - s_dc_ema) >> 7`, which is
 * ASYMMETRIC: an arithmetic right shift rounds toward negative infinity, so
 * a negative gap always moves the tracker down by at least one count while
 * a positive gap under 128 truncates to zero and moves it not at all.
 *
 * The tracker therefore converges to the signal's TROUGH rather than its
 * mean, and `a = |x - dc|` reads about twice the true amplitude. Simulated
 * against this exact integer arithmetic at 512 DC and amplitude 60: the
 * tracker settled at 452 and 403 of 1499 ambient samples crossed
 * BLOW_THRESHOLD_ADC. The effective threshold was about half what config.h
 * says it is — and config.h is what tells whoever tunes this on hardware
 * to trust that number.
 *
 * Holding the accumulator scaled by 128 leaves the rounding bias down in
 * the fractional bits, where it is worth 1/128 of a count. Same simulation:
 * tracks to 510, zero false crossings.
 */
static int32_t  s_dc_acc   = -1;   /* Q7: the DC level times 128 */

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

    s_dc_acc = -1;
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

    if (s_dc_acc < 0) s_dc_acc = (int32_t)x << 7;
    else              s_dc_acc += (((int32_t)x << 7) - s_dc_acc) >> 7;

    int16_t a = x - (int16_t)(s_dc_acc >> 7);
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
