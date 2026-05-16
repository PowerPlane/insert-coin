# Insert Coin — design notes

Concept and constraints that apply across variants. Variant-specific notes belong in `variants/<slug>/README.md`.

## The concept

The card does nothing until you slide a CR2032 into the holder. That gesture *is* the interaction — the "insert coin" of an arcade cabinet, the "scratch here" of a Target gift card from 2002. The card lights up briefly, listens, responds, then quiets down.

Each variant should preserve that core feel: **no buttons, no switches, no USB.** Inserting the coin is the only thing you do.

## Shared constraints

| | |
|---|---|
| **Power budget** | 1 × CR2032 = 220 mAh nominal at ~3.0 V. Drops to ~2.5 V when loaded; firmware must work down to ~2.2 V before the chip's POR catches it. Aim for a card to last *weeks* of casual use. |
| **Average current target** | < 300 µA averaged over a use session (~30 s active, then sleep). Active LED bursts can briefly exceed 10 mA — but only briefly. |
| **Sleep-current target** | < 1 µA when idle. BOD off; peripherals power-gated. |
| **Dimensions** | Roughly business-card: 85 × 54 mm. Some variants may push past this (keychain, badge), but stay pocketable. |
| **Toolchain** | KiCad 8+ for hardware, PlatformIO + megaTinyCore for firmware. UPDI for flashing. |
| **Cost target** | Sub-$5 BOM at low-quantity JLCPCB pricing — the card has to feel "spendable" when handed out. |

## Aesthetic direction

- **Target gift-card-of-2002 nostalgia** — soft red LEDs, mild glow, suggestion of arcade neon without going full RGB.
- **Silkscreen as decoration** — treat the silk layer like print design, not just labels. White-on-black or black-on-white, generous negative space.
- **No exposed ICs on the show side** — the MCU, NFC tag, mic, MOSFETs all live on the back. The front is "the artwork".

## Open ideas (not committed)

- A variant where the "coin" is actually a small magnet that triggers a Hall-effect sensor instead of being a literal CR2032 (then the *real* battery is a sewn-in lithium primary). Preserves the gesture, removes the power constraint.
- A variant where the LED matrix is replaced with a small e-paper segment showing a portfolio QR — better battery life, less "alive" feeling.
- A variant designed to be mailed: the cardboard holder *is* the enclosure, and the recipient inserts the coin from the holder.
