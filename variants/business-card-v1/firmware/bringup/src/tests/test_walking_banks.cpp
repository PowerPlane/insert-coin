#include "test_walking_banks.h"

#include <Arduino.h>

#include "../config.h"
#include "../leds.h"
#include "../pins.h"

namespace test_walking_banks {

void step_once() {
    for (uint8_t i = 0; i < NUM_BANKS; i++) {
        bank_all_mask(1u << i);
        delay(WALK_STEP_MS);
    }
    bank_all_off();
}

[[noreturn]] void run() {
    for (;;) {
        step_once();
    }
}

}  // namespace test_walking_banks
