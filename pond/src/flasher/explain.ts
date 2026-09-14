/**
 * What the page says when a flash fails. One place, plain words.
 *
 * The person reading this has a UPDI Friend in one hand and a card in the
 * other, and did not write any of this code. Every entry says what
 * happened, whether the card is fine, and what to try — in that order.
 * Technical detail goes in the log behind "Show details", not here.
 */

import type { FlashFailure } from "./flasher.js";

export interface Explanation {
  readonly title: string;
  readonly body: string;
  readonly checks: readonly string[];
}

const WIRING = [
  "Coin cell in, and fresh.",
  "UPDI wire on the UPDI pad, GND on GND.",
  "Switch on the UPDI Friend at 3V.",
  "Unplug the UPDI Friend, plug it back in.",
] as const;

const REFLASH = "Flash it again from the top. Nothing about the card is lost.";

export function explain(failure: FlashFailure): Explanation {
  switch (failure.code) {
    case "port":
      return {
        title: "The USB port is busy.",
        body: "Something else has it open, usually the Arduino IDE, a PlatformIO monitor or another tab of this page. Nothing was written.",
        checks: ["Close whatever else talks to the UPDI Friend.", "Unplug it, plug it back in, and pick the port again."],
      };
    case "no-answer":
      return {
        title: "The card did not answer.",
        body: failure.touched
          ? "The card stopped answering part way through. " + REFLASH
          : "Nothing was written, so nothing is broken. One of these is usually it.",
        checks: WIRING,
      };
    case "locked":
      return {
        title: "This chip is locked.",
        body: "Its lock bits are set, and this page does not erase locked chips. Nothing was written. Send the card back to David.",
        checks: [],
      };
    case "wrong-chip":
      return {
        title: "That is not an Insert Coin card.",
        body: "The chip on the other end is not an ATtiny1616, so nothing was written. Details has the id it gave.",
        checks: ["Is the UPDI Friend wired to the card, and nothing else?"],
      };
    case "write-failed":
      return {
        title: "Writing stopped part way.",
        body: "The card is half-written and will not run until it is flashed again. " + REFLASH,
        checks: ["Fresh coin cell. A weak one sags while flash is being written.", "Wires still on their pads."],
      };
    case "verify-failed":
      return {
        title: "The card read back differently from what was written.",
        body: "The code went in but one byte came back wrong. " + REFLASH,
        checks: ["Fresh coin cell. This is nearly always the battery.", "Try 115200 baud from Details if it happens twice."],
      };
    case "fuse-failed":
      return {
        title: "The code is on, but a setting did not take.",
        body: "The firmware was written and verified. One of the chip's fuse settings did not read back as expected. " + REFLASH,
        checks: ["Fresh coin cell.", "If it happens twice, send the card back to David with the details."],
      };
  }
}
