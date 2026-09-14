/**
 * The flasher page, in the browser.
 *
 * Four states and nothing else:
 *
 *   idle ──file──► ready ──Flash──► flashing ──► done
 *                    ▲                  │          │ Flash another
 *                    │                  └──► failed│
 *                    └──────── Try again ◄─────────┘
 *
 * The file stays loaded across cards. The friend has ten to do; picking
 * the file once is the whole point of the page over PlatformIO.
 *
 * Every string the page shows lives in STRINGS below, so a change of
 * wording is one edit and the review of the copy is one read.
 */

import { copyText } from "../client/dom.js";
import { ATTINY1616 } from "./target.js";
import { sha256Hex, shortDigest } from "./digest.js";
import { explain } from "./explain.js";
import { FlashFailure, flashCard, message, type FlashEvent, type UpdiLink } from "./flasher.js";
import { HexError, parseIntelHex } from "./hex.js";
import { UpdiApplication } from "./serialupdi/application.js";

const STRINGS = {
  title: "Flash a card",
  lede: "Plug the UPDI Friend into this laptop, wire it to the card, pick the file David sent, press Flash. About ten seconds a card.",
  ledeFlashing: "Keep the wires still. Pulling the UPDI Friend mid-write only means flashing again.",
  go: "Flash the card",
  going: "Flashing…",
  again: "Flash another card",
  retry: "Try again",
  pickFirst: "Pick a file first.",
  ready: "Press Flash. A port picker opens the first time.",
  noPort: "No port was picked. Press Flash to try again.",
  doneTitle: (serial: string) => `Card ${serial} is flashed.`,
  doneLede: "Pull the coin cell out and put it back in. The card should light up. The first phone tap after that registers it in the pond by itself.",
  fileStill: "Still loaded. Swap the card and go again.",
  notHex: "That is not a .hex file. The one David sent ends in .hex.",
  tooBig: "That file is far too big to be firmware for this card.",
  copied: "Copied",
  copyFailed: "Select it and copy",
  showDetails: "Show details",
  hideDetails: "Hide details",
  checks: {
    connect: "Connect",
    connectAt: (baud: number) => `Connected · ${baud} baud`,
    chip: "Check the chip",
    chipIs: (serial: string) => `${ATTINY1616.name} · card ${serial}`,
    write: "Write",
    writing: (pct: number) => `Writing 16 kB · ${pct}%`,
    written: "Written 16 kB",
    verify: "Verify",
    verifying: (pct: number) => `Verifying · ${pct}%`,
    verified: "Verified",
    fuses: "Fuses",
    fusesSet: "Fuses set, 10 MHz, EEPROM kept",
    noChip: "No chip found",
  },
} as const;

type CheckKey = "connect" | "chip" | "write" | "verify" | "fuses";
const CHECK_ORDER: readonly CheckKey[] = ["connect", "chip", "write", "verify", "fuses"];

/** Web Serial USB vendor filters: WCH (CH340 on the UPDI Friend) and FTDI. */
const KNOWN_ADAPTERS = [{ usbVendorId: 0x1a86 }, { usbVendorId: 0x0403 }];

const MAX_FILE_BYTES = 1024 * 1024;

type State = "idle" | "ready" | "flashing" | "done" | "failed";

interface Loaded {
  readonly name: string;
  readonly image: Uint8Array;
  readonly used: number;
  readonly digest: string;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from the page`);
  return node as T;
}

const ui = {
  gate: el<HTMLElement>("gate"),
  gateCopy: el<HTMLButtonElement>("gate-copy"),
  gateUrl: el<HTMLElement>("gate-url"),
  flow: el<HTMLElement>("flow"),
  title: el<HTMLElement>("title"),
  lede: el<HTMLElement>("lede"),
  drop: el<HTMLLabelElement>("drop"),
  file: el<HTMLInputElement>("file"),
  fileRow: el<HTMLElement>("file-row"),
  fileName: el<HTMLElement>("file-name"),
  fileMeta: el<HTMLElement>("file-meta"),
  fileChange: el<HTMLButtonElement>("file-change"),
  fileHint: el<HTMLElement>("file-hint"),
  error: el<HTMLElement>("error"),
  errorChecks: el<HTMLElement>("error-checks"),
  checks: el<HTMLElement>("checks"),
  bar: el<HTMLElement>("bar"),
  barFill: el<HTMLElement>("bar-fill"),
  go: el<HTMLButtonElement>("go"),
  goHint: el<HTMLElement>("go-hint"),
  detailsToggle: el<HTMLButtonElement>("details-toggle"),
  details: el<HTMLElement>("details"),
  slow: el<HTMLInputElement>("slow"),
  anyPort: el<HTMLInputElement>("any-port"),
  log: el<HTMLElement>("log"),
};

let state: State = "idle";
let loaded: Loaded | null = null;
let port: SerialPort | null = null;

// ── the log ──────────────────────────────────────────────────────────────

function log(text: string): void {
  const stamp = new Date().toLocaleTimeString([], { hour12: false });
  ui.log.textContent += `${stamp} ${text}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

// ── the checklist ────────────────────────────────────────────────────────

function checkRow(key: CheckKey): { row: HTMLElement; text: HTMLElement } {
  const row = ui.checks.querySelector<HTMLElement>(`[data-check="${key}"]`);
  const text = row?.querySelector<HTMLElement>(".f-check-text");
  if (!row || !text) throw new Error(`check row ${key} is missing`);
  return { row, text };
}

function setCheck(key: CheckKey, mode: "todo" | "now" | "done" | "failed", label?: string): void {
  const { row, text } = checkRow(key);
  row.classList.remove("is-now", "is-done", "is-failed");
  if (mode !== "todo") row.classList.add(`is-${mode}`);
  if (label !== undefined) text.textContent = label;
}

function resetChecks(): void {
  setCheck("connect", "todo", STRINGS.checks.connect);
  setCheck("chip", "todo", STRINGS.checks.chip);
  setCheck("write", "todo", STRINGS.checks.write);
  setCheck("verify", "todo", STRINGS.checks.verify);
  setCheck("fuses", "todo", STRINGS.checks.fuses);
  ui.bar.hidden = true;
  ui.barFill.style.width = "0";
}

function setBar(pct: number): void {
  ui.bar.hidden = false;
  ui.barFill.style.width = `${pct}%`;
}

/** Everything a running flash tells the page, mapped onto the rows. */
function onEvent(e: FlashEvent): void {
  switch (e.type) {
    case "phase":
      log(`phase: ${e.phase}`);
      if (e.phase === "connect") setCheck("connect", "now");
      if (e.phase === "identify") setCheck("chip", "now");
      if (e.phase === "write") {
        setCheck("chip", "done");
        setCheck("write", "now", STRINGS.checks.writing(0));
        setBar(0);
      }
      if (e.phase === "verify") {
        setCheck("write", "done", STRINGS.checks.written);
        setCheck("verify", "now", STRINGS.checks.verifying(0));
        setBar(0);
      }
      if (e.phase === "fuses") {
        setCheck("verify", "done", STRINGS.checks.verified);
        setCheck("fuses", "now");
      }
      if (e.phase === "done") {
        setCheck("fuses", "done", STRINGS.checks.fusesSet);
        setBar(100);
      }
      break;
    case "baud":
      setCheck("connect", "done", STRINGS.checks.connectAt(e.baud));
      log(`chip answered at ${e.baud} baud`);
      break;
    case "chip":
      setCheck("chip", "done", STRINGS.checks.chipIs(e.serial));
      log(`device id 0x${e.deviceId.toString(16)}, serial ${e.serial}`);
      break;
    case "progress": {
      const pct = Math.round((e.done / e.total) * 100);
      if (e.phase === "write") setCheck("write", "now", STRINGS.checks.writing(pct));
      if (e.phase === "verify") setCheck("verify", "now", STRINGS.checks.verifying(pct));
      if (e.phase !== "fuses") setBar(pct);
      break;
    }
    case "log":
      log(e.text);
      break;
  }
}

// ── the file ─────────────────────────────────────────────────────────────

function showFile(file: Loaded | null, note?: string): void {
  const has = file !== null;
  ui.drop.hidden = has;
  ui.fileRow.hidden = !has;
  if (file) {
    ui.fileName.textContent = file.name;
    ui.fileMeta.textContent = `${file.used.toLocaleString()} bytes · sha256 ${shortDigest(file.digest)}`;
  }
  ui.fileHint.textContent = note ?? (has ? STRINGS.ready : STRINGS.pickFirst);
}

async function takeFile(file: File): Promise<void> {
  // The drop zone is hidden while a file is loaded, but a drop lands on the
  // document too, and a new file mid-flash would reset the page under a
  // write in progress.
  if (state === "flashing") return;
  if (!/\.hex$/i.test(file.name)) {
    showFile(null, STRINGS.notHex);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showFile(null, STRINGS.tooBig);
    return;
  }
  try {
    // Hashed as the bytes on disk, so it matches `shasum` on David's side
    // even if the file grew a byte-order mark on the way. The text is
    // decoded from those same bytes.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const parsed = parseIntelHex(text, ATTINY1616.flash.size);
    const digest = await sha256Hex(bytes);
    loaded = { name: file.name, image: parsed.image, used: parsed.used, digest };
    log(`loaded ${file.name}: ${parsed.records} records, ${parsed.used} bytes used, sha256 ${digest}`);
    showFile(loaded);
    setState("ready");
  } catch (err) {
    loaded = null;
    const why = err instanceof HexError ? err.message : message(err);
    log(`rejected ${file.name}: ${why}`);
    showFile(null, why);
    setState("idle");
  }
}

// ── the port ─────────────────────────────────────────────────────────────

async function pickPort(): Promise<SerialPort | null> {
  if (port) return port;
  const serial = navigator.serial;
  if (!serial) return null;
  try {
    const filters = ui.anyPort.checked ? undefined : KNOWN_ADAPTERS;
    port = await serial.requestPort(filters ? { filters } : undefined);
    const info = port.getInfo();
    log(`port picked: vid 0x${(info.usbVendorId ?? 0).toString(16)} pid 0x${(info.usbProductId ?? 0).toString(16)}`);
    return port;
  } catch {
    // The picker was dismissed. Not an error, just nothing to do yet.
    return null;
  }
}

function openLink(on: SerialPort): (baud: number) => Promise<UpdiLink> {
  // The constructor starts opening the port; init() awaits it. 1000 ms is
  // WebUPDI's default read timeout and long enough for a CH340 at 230400.
  return (baud) => Promise.resolve(new UpdiApplication(on, baud, ATTINY1616, 1000));
}

// ── the states ───────────────────────────────────────────────────────────

function setState(next: State): void {
  state = next;
  ui.go.disabled = next === "idle" || next === "flashing";
  ui.fileChange.disabled = next === "flashing";
  ui.error.hidden = next !== "failed";
  switch (next) {
    case "idle":
      ui.title.textContent = STRINGS.title;
      ui.lede.textContent = STRINGS.lede;
      ui.go.textContent = STRINGS.go;
      ui.goHint.textContent = STRINGS.pickFirst;
      ui.goHint.hidden = false;
      resetChecks();
      break;
    case "ready":
      ui.title.textContent = STRINGS.title;
      ui.lede.textContent = STRINGS.lede;
      ui.go.textContent = STRINGS.go;
      ui.goHint.textContent = STRINGS.ready;
      ui.goHint.hidden = false;
      resetChecks();
      break;
    case "flashing":
      ui.lede.textContent = STRINGS.ledeFlashing;
      ui.go.textContent = STRINGS.going;
      ui.goHint.hidden = true;
      resetChecks();
      break;
    case "done":
      ui.go.textContent = STRINGS.again;
      ui.goHint.hidden = true;
      ui.lede.textContent = STRINGS.doneLede;
      break;
    case "failed":
      ui.go.textContent = STRINGS.retry;
      ui.goHint.hidden = true;
      break;
  }
}

async function flash(): Promise<void> {
  if (!loaded || state === "flashing") return;
  // Taken before the port picker opens: "Change" can clear `loaded` while
  // the picker is up, and the flash should use what was on screen when
  // Flash was pressed or not run at all.
  const file = loaded;
  const chosen = await pickPort();
  if (!chosen) {
    ui.goHint.hidden = false;
    ui.goHint.textContent = STRINGS.noPort;
    return;
  }
  if (loaded !== file) return;
  setState("flashing");
  ui.title.textContent = STRINGS.title;
  const bauds = ui.slow.checked ? [115200] : undefined;
  try {
    const result = await flashCard(openLink(chosen), file.image, ATTINY1616, onEvent, bauds ? { bauds } : {});
    log(`done: ${result.pagesWritten} pages written, ${result.pagesErased} erased, serial ${result.serial}`);
    ui.title.textContent = STRINGS.doneTitle(result.serial);
    showFile(file, STRINGS.fileStill);
    setState("done");
  } catch (err) {
    const failure = err instanceof FlashFailure ? err : null;
    log(`failed: ${failure ? `${failure.code} in ${failure.phase}: ` : ""}${message(err)}`);
    if (failure?.detail instanceof Error && failure.detail.message !== failure.message) {
      log(`  ${failure.detail.message}`);
    }
    if (failure) {
      const why = explain(failure);
      ui.title.textContent = why.title;
      ui.lede.textContent = why.body;
      ui.errorChecks.replaceChildren(
        ...why.checks.map((c) => {
          const li = document.createElement("li");
          li.textContent = c;
          return li;
        }),
      );
      failedRow(failure.phase);
      // A port that would not open is not worth keeping; the next attempt
      // asks again. Everything else keeps the port so a retry is one click.
      if (failure.code === "port") port = null;
      setState("failed");
      // After setState, which shows the block; an explanation with nothing
      // to check has no block to show.
      ui.error.hidden = why.checks.length === 0;
    } else {
      ui.title.textContent = "Something unexpected went wrong.";
      ui.lede.textContent = message(err);
      setState("failed");
      ui.error.hidden = true;
    }
  }
}

/** Mark the row where it stopped, keep the ones before as they were. */
function failedRow(phase: FlashFailure["phase"]): void {
  const key: CheckKey =
    phase === "connect" ? "connect" : phase === "identify" ? "chip" : phase === "done" ? "fuses" : phase;
  const label = key === "chip" ? STRINGS.checks.noChip : undefined;
  setCheck(key, "failed", label);
  for (const later of CHECK_ORDER.slice(CHECK_ORDER.indexOf(key) + 1)) setCheck(later, "todo");
}

// ── wiring the page ──────────────────────────────────────────────────────

function wire(): void {
  ui.file.addEventListener("change", () => {
    const f = ui.file.files?.[0];
    if (f) void takeFile(f);
    ui.file.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    ui.drop.addEventListener(type, (e) => {
      e.preventDefault();
      ui.drop.classList.add("is-over");
    });
  }
  ui.drop.addEventListener("dragleave", () => ui.drop.classList.remove("is-over"));
  ui.drop.addEventListener("drop", (e) => {
    e.preventDefault();
    ui.drop.classList.remove("is-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) void takeFile(f);
  });
  // A file dropped anywhere else would navigate the tab away, mid-session.
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  ui.fileChange.addEventListener("click", () => {
    if (state === "flashing") return;
    loaded = null;
    showFile(null);
    setState("idle");
  });

  ui.go.addEventListener("click", () => void flash());

  ui.detailsToggle.addEventListener("click", () => {
    const open = ui.details.hidden;
    ui.details.hidden = !open;
    ui.detailsToggle.setAttribute("aria-expanded", String(open));
    ui.detailsToggle.textContent = open ? STRINGS.hideDetails : STRINGS.showDetails;
  });

  ui.anyPort.addEventListener("change", () => {
    port = null; // the next Flash asks again, with the new filter
  });

  window.addEventListener("beforeunload", (e) => {
    if (state === "flashing") e.preventDefault();
  });
}

function boot(): void {
  ui.gateUrl.textContent = `${location.host}${location.pathname}`;
  if (!navigator.serial) {
    ui.gate.hidden = false;
    ui.gateCopy.addEventListener("click", () => {
      // The gate shows in exactly the browsers where the clipboard is
      // fussiest, so the failure path gets a word too.
      void copyText(location.href).then((ok) => {
        ui.gateCopy.textContent = ok ? STRINGS.copied : STRINGS.copyFailed;
      });
    });
    return;
  }
  ui.flow.hidden = false;
  wire();
  showFile(null);
  setState("idle");
  log(`ready. target ${ATTINY1616.name}, ${ATTINY1616.flash.size} bytes of flash`);
}

boot();
