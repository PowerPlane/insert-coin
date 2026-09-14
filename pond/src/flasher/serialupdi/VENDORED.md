# serialupdi — vendored from WebUPDI

Source: https://github.com/manuelkasper/webupdi, commit
`29b2be65826f8ef46ccd4c140dc7373242792cc0`, directory `serialupdi/`.
MIT licence, Microchip Technology Inc. and Manuel Kasper — see `LICENSE`
beside this file. WebUPDI is itself a TypeScript port of Microchip's
[pymcuprog](https://github.com/microchip-pic-avr-tools/pymcuprog).

Copied rather than installed because it is not published as a package,
and because the pond ships a committed bundle with no build at deploy.

## Changes from upstream

Kept deliberately small so a future update is a diff, not a merge.

| File | Change | Why |
| --- | --- | --- |
| `nvmp2..5.ts` | Removed | AVR Dx/Ex NVM drivers. The card is a tinyAVR (P:0) and the flasher refuses any other chip before it writes. |
| `application.ts` | Only the P:0 driver is selected; other revisions throw | Follows the removal above. |
| `application.ts` | Added `writeFlashErase`, `writeFuse`, `destroy` | The flasher writes pages with erase-and-write (no chip erase, so EEPROM is never touched) and sets fuses. `destroy` releases the port. |
| `nvm.ts`, `nvmp0.ts` | Added `writeFlashErase` (NVM command `ERWP`) | Same. |
| `physical.ts` | `readWithTimeout` clears its timeout once the read settles | Upstream left one pending timer per read; a flash is thousands of reads. |
| `nvm.ts`, `nvmp0.ts`, `application.ts` | `device` is a typed `UpdiDevice` instead of `any` | An object with the wrong field names would have sent every NVM command to address 0 without a type error. |
| `physical.ts` | `sendBreak` awaits `setSignals`; `sendDoubleBreak` awaits each break | Upstream fired both breaks concurrently, which is one break. |
| `link.ts`, `nvmp0.ts`, `readwrite.ts`, `application.ts` | `override` keywords and `?? 0` on indexed reads | The pond compiles with `noImplicitOverride` and `noUncheckedIndexedAccess`. No behaviour change: a typed array already reads a missing index as 0. |

Nothing else is edited. Type declarations for Web Serial live in
`../web-serial.d.ts`.
