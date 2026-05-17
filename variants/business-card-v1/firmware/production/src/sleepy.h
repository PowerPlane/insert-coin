// Terminal deep-sleep helper. Called once when the show is over; never
// returns. Coin removal + reinsert is the only way out (cold boot).

#pragma once

[[noreturn]] void sleep_forever();
