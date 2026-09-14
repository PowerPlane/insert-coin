/**
 * `/flash` — the page a friend opens to put firmware on a card.
 *
 * Server-rendered like every other HTML route (there is no public/*.html,
 * and test/deploy-shape.test.ts keeps it that way), though this one needs
 * no cookie and no database: it is a function only because the CDN would
 * otherwise serve it, and the rule is simpler with no exceptions.
 *
 * Everything the page does happens in the browser, in public/flash.js,
 * against a UPDI Friend on a USB port. The server never sees a firmware
 * file. That is the point: the pond firmware carries a signing key, so
 * the file travels from David to the friend directly and is never hosted.
 *
 * The markup is the design canvas made real. Ids are the contract with
 * src/flasher/main.ts; test/flasher-page.test.ts checks every id the
 * script asks for is here.
 */

const WIRING = `<svg class="f-wiring" viewBox="0 0 440 180" fill="none" stroke="#0b3d52" stroke-width="2" font-family="ui-monospace, Menlo, monospace" font-size="11" role="img" aria-label="UPDI Friend to card: UPDI to UPDI, GND to GND, VCC left open, switch at 3V, CR2032 in the card">
  <rect x="12" y="34" width="150" height="112"></rect>
  <text x="87" y="26" text-anchor="middle" fill="#0b3d52" stroke="none" letter-spacing="1.5">UPDI FRIEND</text>
  <rect x="22" y="44" width="34" height="16"></rect>
  <rect x="24" y="46" width="14" height="12" fill="#0b3d52" stroke="none"></rect>
  <text x="64" y="57" fill="#0b3d52" stroke="none">3V</text>
  <circle cx="162" cy="78" r="5" fill="#f2fbfe"></circle>
  <circle cx="162" cy="106" r="5" fill="#f2fbfe"></circle>
  <circle cx="162" cy="134" r="5" fill="#f2fbfe"></circle>
  <text x="150" y="82" text-anchor="end" fill="#0b3d52" stroke="none">UPDI</text>
  <text x="150" y="110" text-anchor="end" fill="#0b3d52" stroke="none">GND</text>
  <text x="150" y="138" text-anchor="end" fill="#0b3d52" stroke="none">VCC</text>
  <rect x="278" y="34" width="150" height="112"></rect>
  <text x="353" y="26" text-anchor="middle" fill="#0b3d52" stroke="none" letter-spacing="1.5">CARD</text>
  <circle cx="278" cy="78" r="5" fill="#f2fbfe"></circle>
  <circle cx="278" cy="106" r="5" fill="#f2fbfe"></circle>
  <text x="290" y="82" fill="#0b3d52" stroke="none">UPDI</text>
  <text x="290" y="110" fill="#0b3d52" stroke="none">GND</text>
  <circle cx="392" cy="112" r="20" fill="#ffca00" stroke="#c08508"></circle>
  <text x="392" y="116" text-anchor="middle" fill="#4a3a06" stroke="none" font-size="9">CR2032</text>
  <path d="M167 78 H273"></path>
  <path d="M167 106 H273"></path>
  <path d="M167 134 H200" stroke-dasharray="4 4"></path>
  <path d="M206 128 L218 140 M218 128 L206 140"></path>
  <text x="212" y="158" text-anchor="middle" fill="#5b8699" stroke="none" font-size="10">leave open</text>
  <text x="220" y="72" text-anchor="middle" fill="#2d6076" stroke="none" font-size="10">UPDI</text>
  <text x="220" y="100" text-anchor="middle" fill="#2d6076" stroke="none" font-size="10">GND</text>
</svg>`;

const FILE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0b3d52" stroke-width="2" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"></path><path d="M14 3v5h5"></path></svg>`;

function step(n: number, title: string, body: string, id: string): string {
  return `<section class="f-step" id="${id}">
  <h2 class="f-stepnum"><b>${n}</b><span>${title}</span></h2>
  ${body}
</section>`;
}

const CHECKS = [
  ["connect", "Connect"],
  ["chip", "Check the chip"],
  ["write", "Write"],
  ["verify", "Verify"],
  ["fuses", "Fuses"],
] as const;

export function flashShell(): string {
  const checks = CHECKS.map(
    ([key, label]) =>
      `<li class="f-check" data-check="${key}"><span class="f-box" aria-hidden="true"></span><span class="f-check-text">${label}</span></li>`,
  ).join("\n    ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Flash a card · Insert Coin</title>
<link rel="stylesheet" href="/flash.css">
</head>
<body>
<main class="f-page">
  <div class="p-edge" aria-hidden="true"><i class="p-d25"></i><i class="p-d50"></i><i class="p-d75"></i></div>

  <section class="f-sheet" id="gate" hidden>
    <header class="f-head">
      <p class="p-eyebrow">Insert coin · business card v1</p>
      <h1 class="p-title">Open this in Chrome or Edge, on a laptop.</h1>
      <p class="p-body">Talking to the card over USB needs Web Serial. Safari, Firefox and phones do not have it, so this page has nothing to plug into.</p>
    </header>
    ${step(1, "Copy the link", `<div class="f-file"><span class="f-mono" id="gate-url">ducky.davidyang.work/flash</span><button class="p-chip" type="button" id="gate-copy">Copy</button></div>`, "gate-step-copy")}
    ${step(2, "Open it there", `<p class="p-body">Chrome or Edge, on a Mac or Windows laptop with a free USB port.</p>`, "gate-step-open")}
  </section>

  <section class="f-sheet" id="flow" hidden>
    <header class="f-head">
      <p class="p-eyebrow">Insert coin · business card v1</p>
      <h1 class="p-title" id="title">Flash a card</h1>
      <p class="p-body" id="lede">Plug the UPDI Friend into this laptop, wire it to the card, pick the file David sent, press Flash. About ten seconds a card.</p>
    </header>

    ${step(
      1,
      "Wire it up",
      `${WIRING}
  <div class="f-hints">
    <p class="p-hint">Switch on the UPDI Friend set to 3V.</p>
    <p class="p-hint">Fresh CR2032 in the card. Nothing on VCC.</p>
  </div>`,
      "step-wire",
    )}

    ${step(
      2,
      "Pick the firmware",
      `<label class="f-drop" id="drop">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0b3d52" stroke-width="2" aria-hidden="true"><path d="M12 4v11"></path><path d="M7 10l5 5 5-5"></path><path d="M4 19h16"></path></svg>
    <span class="p-field-label f-drop-label">Drop the .hex file here</span>
    <span class="p-chip f-drop-chip">or choose a file</span>
    <input type="file" id="file" accept=".hex,text/plain" class="p-sr">
  </label>
  <div class="f-file" id="file-row" hidden>
    ${FILE_ICON}
    <div class="f-file-text">
      <span class="f-mono" id="file-name"></span>
      <span class="p-hint f-file-meta" id="file-meta"></span>
    </div>
    <button class="p-linkish" type="button" id="file-change">Change</button>
  </div>
  <p class="p-hint" id="file-hint">The file David sent. Nothing else fits on the card.</p>`,
      "step-file",
    )}

    ${step(
      3,
      "Flash",
      `<div class="f-danger" id="error" hidden>
    <span class="p-field-label f-danger-label">Check</span>
    <ul class="f-danger-list" id="error-checks"></ul>
  </div>
  <ol class="f-checks" id="checks" aria-live="polite">
    ${checks}
  </ol>
  <div class="f-bar" id="bar" hidden><i id="bar-fill"></i></div>
  <button class="p-btn" type="button" id="go" disabled>Flash the card</button>
  <p class="p-hint" id="go-hint">Pick a file first.</p>
  <div class="f-utils">
    <button class="p-linkish" type="button" id="details-toggle" aria-expanded="false" aria-controls="details">Show details</button>
  </div>
  <div id="details" hidden>
    <label class="f-option"><input type="checkbox" id="slow"> <span>Slow mode: 115200 baud only</span></label>
    <label class="f-option"><input type="checkbox" id="any-port"> <span>Show every serial port, not just UPDI Friend and FTDI</span></label>
    <pre class="f-log" id="log"></pre>
  </div>`,
      "step-flash",
    )}
  </section>

  <p class="p-wordmark">BY-002 · INSERT COIN</p>
</main>
<script type="module" src="/flash.js"></script>
</body>
</html>
`;
}
