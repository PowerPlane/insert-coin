// Pin map for business-card-v1 (ATtiny1616 VQFN-20).
// Verified against hardware/production/netlist.ipc — do not edit without
// re-checking the netlist.
//
// TODO: extract to insert-coin/shared/firmware/ when production firmware
// is written and a second consumer exists.

#pragma once

#include <Arduino.h>

#define NUM_BANKS 9

// LED cathode-bank gate drivers (active high; gate HIGH -> bank lit).
// Each "bank" sinks the cathodes of a fixed group of LEDs to GND.
//
//   Bank 0  PA1  D1, D2          (Q1)
//   Bank 1  PA2  D3, D4          (Q2)
//   Bank 2  PA3  D5, D6          (Q3)
//   Bank 3  PA4  D7, D8          (Q4)
//   Bank 4  PA5  D9, D10, D11, D12   (Q5)
//   Bank 5  PA6  D13, D14, D15, D16  (Q7)
//   Bank 6  PA7  D17, D18, D19, D20  (Q8)
//   Bank 7  PB2  D21, D22        (Q9)
//   Bank 8  PB3  D23, D24        (Q10)
//
// Individual-LED addressing is not possible: all 24 anodes go through
// individual current-limit resistors to VCC, so an LED is lit whenever
// its bank's MOSFET is on.
constexpr uint8_t LED_BANK_PINS[NUM_BANKS] = {
    PIN_PA1, PIN_PA2, PIN_PA3, PIN_PA4, PIN_PA5,
    PIN_PA6, PIN_PA7, PIN_PB2, PIN_PB3,
};

// Microphone analog input.
// On the ATtiny1616 txy6 pin map, PC0 is ADC1 AIN6 -- NOT ADC0 AIN6
// (ADC0 AIN6 is PA6, which is LED bank 5). Sampling ADC0 here would
// read the LED gate, not the mic.
#define MIC_PIN          PIN_PC0
#define MIC_ADC          ADC1
#define MIC_ADC_MUXPOS   ADC_MUXPOS_AIN6_gc

// I2C bus to ST25DV04K NFC tag (default TWI pins).
//   PB0 = SCL
//   PB1 = SDA
// The PCB has no external pull-ups; firmware enables the ATtiny's
// internal pull-ups before Wire.begin().
#define ST25DV_I2C_ADDR_USER   0x53  // 7-bit, user EEPROM
#define ST25DV_I2C_ADDR_SYSTEM 0x57  // 7-bit, system config area

// Pins broken out from the MCU but not wired to anything on the PCB.
// Disable their input buffers to keep sleep leakage down.
//   PB4 -- /LED10 net stub: out of MCU but nothing on the other end
//   PB5 -- no connect
//   PC1, PC2, PC3 -- no connect
constexpr uint8_t UNUSED_PINS[] = {
    PIN_PB4, PIN_PB5, PIN_PC1, PIN_PC2, PIN_PC3,
};
constexpr uint8_t NUM_UNUSED_PINS = sizeof(UNUSED_PINS) / sizeof(UNUSED_PINS[0]);
