#include "leds.h"

#include "pins.h"

// Pre-computed PORTA / PORTB bit masks for each bank.
// Banks 0..6 live on PORTA bits 1..7; banks 7..8 on PORTB bits 2..3.
static constexpr uint8_t BANK_PORTA_MASK =
    (1u << 1) | (1u << 2) | (1u << 3) | (1u << 4) |
    (1u << 5) | (1u << 6) | (1u << 7);
static constexpr uint8_t BANK_PORTB_MASK = (1u << 2) | (1u << 3);

void bank_init() {
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        pinMode(LED_BANK_PINS[i], OUTPUT);
        digitalWrite(LED_BANK_PINS[i], LOW);
    }
}

void bank_set(uint8_t idx, bool on) {
    if (idx >= NUM_BANKS) return;
    digitalWrite(LED_BANK_PINS[idx], on ? HIGH : LOW);
}

void bank_all_mask(uint16_t mask) {
    // Banks 0..6 -> PORTA bits 1..7 (shift mask<<1).
    uint8_t a = (uint8_t)((mask & 0x7Fu) << 1);
    // Banks 7..8 -> PORTB bits 2..3 (shift mask>>7 then <<2 = shift mask>>5).
    uint8_t b = (uint8_t)(((mask >> 7) & 0x03u) << 2);

    PORTA.OUT = (PORTA.OUT & ~BANK_PORTA_MASK) | a;
    PORTB.OUT = (PORTB.OUT & ~BANK_PORTB_MASK) | b;
}
