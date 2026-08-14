/**
 * Droplets, mist and streamers — the pixels that are thrown.
 *
 * ══ WHY THIS IS SEPARATE FROM THE SPARKLE ENGINE ══
 * A sparkle is SCHEDULED: every pixel knows in advance when it turns on
 * and off, because a shape has to arrive as a shape. A particle is
 * SIMULATED: it is given a shove and then obeys drag until it dies. The
 * two look similar on screen and share nothing at all underneath, and
 * trying to express one in terms of the other is how you get a fountain
 * that arrives in formation.
 *
 * Everything here is in WORLD sprite units per second, and one particle
 * draws as exactly one sprite pixel. They do not fade — a pixel is on or
 * it is off, which is the same rule the water and the ducks follow.
 */

/** Drag per second: what makes a thrown thing slow down. */
const DRAG = 0.82;
/** World units per second, per unit of stored velocity. */
const SPEED = 8;
/** Upward pull on anything that rises. Steam goes up; water does not. */
const RISE = 9;

/** Water thrown by an impact. Two whites so a splash is not one flat colour. */
const DROPLET_COLOURS = ["#FFFFFF", "#CFEDF8"] as const;
/** How often the brighter of the two is chosen. */
const DROPLET_WHITE_CHANCE = 0.45;

/** Steam off a fire that has just gone out. */
const MIST_COLOURS = ["#FFFFFF", "#E4F4FA"] as const;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  colour: string;
  /** Seconds remaining. */
  life: number;
  /** True for steam, which climbs. */
  rise: boolean;
}

export function emit(
  list: Particle[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  colour: string,
  life: number,
  rise = false,
): void {
  list.push({ x, y, vx, vy, colour, life, rise });
}

/**
 * Advance every particle one tick and drop the dead ones.
 *
 * Mutates in place and returns the same array: at a few hundred particles
 * this runs every tick, and allocating a new array each time is the kind
 * of cost that only shows up on somebody's phone.
 */
export function advanceParticles(list: Particle[], dt: number): Particle[] {
  let live = 0;
  for (const p of list) {
    p.x += p.vx * dt * SPEED;
    // Steam climbs against its own velocity; water just falls away.
    p.y += (p.vy - (p.rise ? RISE : 0)) * dt * SPEED;
    p.vx *= DRAG;
    p.vy *= DRAG;
    p.life -= dt;
    if (p.life > 0) list[live++] = p;
  }
  list.length = live;
  return list;
}

/**
 * The water thrown by an impact.
 *
 * `amplitude` is the same scale the ripple uses — 1 is an ordinary touch —
 * so a heavier hit throws both more droplets and faster ones.
 */
export function splashDroplets(
  list: Particle[],
  x: number,
  y: number,
  amplitude: number,
  random: () => number = Math.random,
): void {
  const count = 6 + Math.floor(amplitude * 2);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = (9 + random() * 9) * amplitude * 0.5;
    emit(
      list,
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      random() < DROPLET_WHITE_CHANCE ? DROPLET_COLOURS[0] : DROPLET_COLOURS[1],
      0.24 + random() * 0.14,
    );
  }
}

/**
 * Steam off a fire going out.
 *
 * Slower than a splash and it climbs, because that is the difference
 * between water being thrown and water becoming air. The `-2` on the
 * vertical gives it a push upward at birth so it leaves the duck rather
 * than sitting on it.
 */
export function douseMist(
  list: Particle[],
  x: number,
  y: number,
  count = 20,
  random: () => number = Math.random,
): void {
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = 2 + random() * 7;
    emit(
      list,
      x,
      y,
      Math.cos(angle) * speed * 0.7,
      Math.sin(angle) * speed * 0.5 - 2,
      random() < 0.5 ? MIST_COLOURS[0] : MIST_COLOURS[1],
      0.55 + random() * 0.45,
      true,
    );
  }
}

/**
 * 大吉's streamers: two waves, the second slower and later.
 *
 * One burst reads as an explosion. Two, staggered, read as a firework —
 * and 大吉 is the fortune nobody else got today, so it is the one moment
 * in the pond allowed to be loud.
 */
export function fireworkStreamers(
  list: Particle[],
  x: number,
  y: number,
  colours: readonly string[],
  random: () => number = Math.random,
): void {
  for (let wave = 0; wave < 2; wave++) {
    for (let i = 0; i < 20; i++) {
      const angle = random() * Math.PI * 2;
      const speed = (11 + random() * 22) * (wave ? 0.7 : 1);
      emit(
        list,
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        colours[i % colours.length]!,
        // The later wave lives longer, so both are still in the air together.
        0.5 + random() * 0.3 + wave * 0.2,
        true,
      );
    }
  }
}
