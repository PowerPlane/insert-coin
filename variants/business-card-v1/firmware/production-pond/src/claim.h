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
// ══ WHY THE WINDOW CLOSES EARLY ══
// The design opens a ten-second window on every power-up. Taken literally
// that taxes every boot — including the ordinary one, where somebody put a
// coin in to watch a duck and has no idea a gesture exists.
//
// But only a person who is ALREADY BLOWING is claiming. So the window
// closes after CLAIM_FIRST_BLOW_MS if nothing has arrived, and only opens
// out to the full ten seconds once the first blow lands. The keeper gets
// their window; the visitor waits about two seconds and never learns there
// was one.

#pragma once

#include <stdbool.h>
#include <stdint.h>

// Listen for the gesture. Blocking, and it lights one LED per blow so the
// count is visible — stopping at three has to look different from stopping
// at four, or a failure is indistinguishable from a card that is broken.
//
// Returns true only when CLAIM_BLOWS have landed. Leaves the mic running:
// the caller owns mic_init/mic_deinit.
bool claim_listen();

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
