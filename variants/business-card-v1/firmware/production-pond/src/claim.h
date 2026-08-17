// Claiming a card: four blows, and the tag says so.
//
// ══ WHY A GESTURE AND NOT A LINK ══
// Everything in the tag's URL is typed text. A tap can be done across a bar
// table by anyone; `?d=8&c=7F3A9K` in a browser address bar proves nothing
// at all. So possession has to be proved by something a stranger cannot do
// without the card in their hand — and blowing into its microphone four
// times, while the battery is in, is exactly that.
//
// The proof is not the gesture, though. The proof is the COUNTER the
// gesture moves. The server accepts a claim only when the counter exceeds
// the highest it has ever seen for that card, so a URL read over somebody's
// shoulder is already spent by the time they try it. To claim your card
// they have to make the number go up, and only the gesture does that.
//
// ══ WHY THERE IS NO WINDOW ══
// The gesture used to get 2.5 seconds of its own, after the boot flash and
// before the show, with the LEDs off. It did not work, and the bench found
// it immediately: an invisible pause is indistinguishable from the card
// thinking, and it was over before anybody would react. You had to already
// be blowing as you pushed the coin in.
//
// So the show itself is the window now. The mic stays up, the animations
// pump the watcher between frames, and four blows count whenever they
// arrive. Landing them abandons the show — no lottery, no reveal, no
// fortune patched onto the tag — because setting a card up is not a turn
// at the game, and burning a fortune nobody will claim was the old
// behaviour's other half.

#pragma once

#include <stdbool.h>
#include <stdint.h>

// Start watching for the gesture. Non-blocking; the show pumps it.
void claim_watch_begin();

// Pump the watcher for `ms`, sampling the mic and counting blows, then
// return false. Returns true EARLY — and immediately on every later call —
// once CLAIM_BLOWS have landed, which is how the animations know to stop
// spending time on frames nobody is going to see.
//
// The caller owns mic_init/mic_deinit; the mic must be up.
bool claim_watch_delay(uint16_t ms);

// Have the four blows landed? Cheap, and safe to ask after the show.
bool claim_watch_done();

// Sit in setup mode until the keeper leaves or the window runs out.
//
// Dark and listening. Four blows retire the claim and return true; the
// window expiring returns false. Each blow lights one ducky frame — the
// count is shown HERE and not during the show, because here the banks are
// idle and whoever is blowing meant to be.
//
// Blocking, and the CPU stays awake throughout. Requires the mic to be up.
bool claim_setup_wait(uint16_t seconds);

// Arm the tag. Advances the card's claim counter, signs it, and rewrites
// the two spans that carry a claim — `&g=` and `&t=` — in place.
//
// Returns false if the card is not provisioned, if the counter could not be
// persisted, or if any byte would not take. A false return means nothing
// was promised: the tag still holds whatever it held before, which is a
// counter the server has already retired.
//
// Requires ndef_init() to have been called.
bool claim_arm();

// Put the tag back to an unclaimable counter.
//
// An armed URL that stays armed is a claim lying on the floor. The card
// already clears the fortune digit when it expires; this clears the claim
// on the same schedule and for the same reason.
bool claim_disarm();
