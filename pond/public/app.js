/**
 * PLACEHOLDER. Phase 3 replaces this file entirely.
 *
 * Its whole job is to make a deployment checkable: it reads the bootstrap
 * the server rendered, calls the one endpoint the phase is done-when-it-
 * returns, and says what came back. If this shows a duck count, the port
 * worked — the database is reachable, the session cookie survived the CDN,
 * and the API is answering.
 *
 * Everything is written with textContent rather than innerHTML. Nothing
 * here handles user text today, but the shell it renders into will be full
 * of duck names and messages by Phase 3, and a placeholder that models the
 * wrong habit is how the wrong habit ends up in the real thing.
 *
 * The real client is nine screens against these same responses. See
 * docs/pond/UI.md and docs/pond/FLOW.md.
 */

const root = document.getElementById("pond");
const boot = JSON.parse(document.getElementById("pond-bootstrap").textContent || "{}");

function line(text, tag) {
  const p = document.createElement("p");
  if (tag) {
    const el = document.createElement(tag);
    el.textContent = text;
    p.appendChild(el);
  } else {
    p.textContent = text;
  }
  root.appendChild(p);
}

async function main() {
  line("the pond", "strong");
  line(`view: ${boot.view}`);

  try {
    const [pond, session] = await Promise.all([
      fetch("/api/pond").then((r) => r.json()),
      fetch("/api/session").then((r) => r.json()),
    ]);
    const n = pond.ducks.length;
    line(`${n} duck${n === 1 ? "" : "s"}`, "strong");
    line(
      session.active
        ? `you have a fortune waiting (${session.fortune})`
        : "slide a coin in to get one",
    );
  } catch (err) {
    line("the pond is not answering");
    console.error(err);
  }

  line("Phase 3 builds the rest.", "small");
}

main();
