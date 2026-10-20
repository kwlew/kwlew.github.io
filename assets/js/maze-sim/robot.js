// Robot simulation: sensing, frontier exploration across both levels, ramp,
// debris, black/blue tile handling.
// Pure, DOM-free; the renderer reads the Sim and calls step()/pose().
import { DIRS, levelOf, cellOf, neighbourNode, neighbours } from "./maze.js?v=10";
import { castBeams, applyBeams } from "./sensors.js?v=10";
import { kitsRequired } from "./scoring.js?v=10";
import { mulberry32 } from "./rng.js?v=10";

export const STEP_MS = 200;
export const TURN_MS = 120;
export const SENSE_MS = 150;
export const HOLD_MS = 2500;
export const FADE_MS = 400;
export const BLUE_WAIT_MS = 1500;       // the real rule is a 5 s stop; scaled like the rest of the sim
export const PROBE_DEPTH = 0.38;        // how far onto a black tile the robot gets before backing out
export const IDENTIFY_MS = 600;         // time to identify a victim on arrival
export const KIT_MS = 250;              // time per rescue kit dropped
export const MAX_TICK = 50;             // longest simulated slice per update, so fast speeds skip nothing
export const RAMP_MS = 2.5 * STEP_MS;   // driving the ramp between levels
export const DEBRIS_MS = 2 * STEP_MS;   // entering a debris tile
export const LEVEL_FADE_MS = 400;       // view cross-fade between levels, centred on the ramp arrival
const RAMP_TRAVEL = 0.2;                // tiles driven along the ramp tile while climbing (body stays inside the cell)
export const BODY = 0.44;               // robot body side, tiles
export const BODY_SWELL = 0.15;         // extra body size at mid-climb, fraction (the tilt cue)
const WOBBLE = 0.04;                    // debris lateral wobble amplitude, tiles
export const DRIFT_MAX = 0.6;           // gyro drift bound, degrees
const DRIFT_TICK_MS = 50;               // straight-line time per drift random-walk step
const DRIFT_STEP = 0.25;                // largest single drift step, degrees
const MM_PER_TILE = 300;

export const PHASES = ["EXPLORING", "RETURNING", "IDENTIFY", "KIT DROP", "RAMP", "COMPLETE", "FADE"];

// known: Map<node id, [N, E, S, W]> of true (wall) / false (open) / null (unsensed),
// filled in from the ToF beams (sim.beams holds the latest cast).
// visited, black: Set<node id>. trail: [{ node, t }]. found: Map<Victim, clock ms>.
// drift: gyro error in degrees, random-walking within ±DRIFT_MAX during straight moves
// (own PRNG stream, consumed only here) and 0 through each turn; gyro: the heading in
// degrees [0, 360) as the gyro reports it (exact heading × 90 + drift, swept during turns).
// identified: Set of victim indices (flat, in level order); kits: kits dropped per victim index.
// IDENTIFY / KIT DROP / RAMP temporarily replace the travel phase, which is kept in resumePhase.
// level: the level the robot is on (switches when a ramp traversal ends); rampTraversals:
// completed ramp crossings; levelFade: { from, to, start } of the latest level cross-fade.
export function createSim(field) {
  const sim = {
    seed: field.seed,
    run: 1,
    field,
    known: new Map(),
    visited: new Set(),
    found: new Map(),
    identified: new Set(),
    kits: new Array(field.levels.reduce((n, level) => n + level.victims.length, 0)).fill(0),
    task: null,
    resumePhase: null,
    pendingBlue: false,
    pos: field.start,
    level: levelOf(field.start),
    rampTraversals: 0,
    levelFade: null,
    heading: 0,
    angle: 0,
    step: null,
    route: null,
    phase: "EXPLORING",
    clock: 0,
    runTime: 0,
    senseAt: -Infinity,
    beams: [],
    drift: 0,
    driftAcc: 0,
    driftRand: mulberry32(field.seed ^ 0x27d4eb2f),
    gyro: 0,
    trail: [],
    black: new Set(),
    waitUntil: 0,
    readyAt: 0,
    hold: 0
  };
  arrive(sim, field.start, 0);
  return sim;
}

const levelAt = (sim, node) => sim.field.levels[levelOf(node)];

function knownAt(sim, node) {
  let entry = sim.known.get(node);
  if (!entry) {
    entry = [null, null, null, null];
    sim.known.set(node, entry);
  }
  return entry;
}

// Cast the four ToF beams from the current cell and map what they saw.
function sense(sim, node, at) {
  sim.beams = castBeams(sim.field, node, sim.heading);
  applyBeams(sim.known, sim.beams, sim.field);
  for (const victim of levelAt(sim, node).victims) {
    if (victim.node === node && !sim.found.has(victim)) sim.found.set(victim, at);
  }
  sim.senseAt = at;
}

// Arrival at node at sim time `at` (the exact end of the move, which may fall
// inside the current slice); everything that follows is timed from there.
function arrive(sim, node, at) {
  sim.pos = node;
  sim.level = levelOf(node);
  sim.readyAt = at;
  sim.trail.push({ node, t: at });
  sim.visited.add(node);
  sense(sim, node, at);
  const blue = levelAt(sim, node).tiles[cellOf(node)] === "blue";
  startTask(sim, node, at);
  if (blue) {
    // A blue stop begins once any identify / kit work on this cell is done.
    if (sim.task) sim.pendingBlue = true;
    else sim.waitUntil = at + BLUE_WAIT_MS;
  }
}

// Flat victim index: position in the level-ordered list of all victims.
function victimIndex(sim, node) {
  const level = levelOf(node);
  let offset = 0;
  for (let l = 0; l < level; l++) offset += sim.field.levels[l].victims.length;
  const at = levelAt(sim, node).victims.findIndex(victim => victim.node === node);
  return at < 0 ? -1 : offset + at;
}

// On arrival at a cell with an unidentified victim, begin identification.
function startTask(sim, node, at) {
  const index = victimIndex(sim, node);
  if (index < 0 || sim.identified.has(index)) return;
  const victim = levelAt(sim, node).victims.find(v => v.node === node);
  sim.resumePhase = sim.phase;
  sim.phase = "IDENTIFY";
  sim.task = { index, type: victim.type, until: at + IDENTIFY_MS, kitsLeft: kitsRequired(victim.type) };
}

// Advance IDENTIFY / KIT DROP. Deadlines chain from each other, so the result
// does not depend on how the elapsed time was sliced.
function runTask(sim) {
  const task = sim.task;
  while (task && sim.clock >= task.until) {
    if (sim.phase === "IDENTIFY") {
      sim.identified.add(task.index);
      if (task.kitsLeft > 0) {
        sim.phase = "KIT DROP";
        task.until += KIT_MS;
        continue;
      }
    } else {
      sim.kits[task.index]++;
      task.kitsLeft--;
      if (task.kitsLeft > 0) {
        task.until += KIT_MS;
        continue;
      }
    }
    sim.phase = sim.resumePhase;
    sim.resumePhase = null;
    sim.task = null;
    sim.readyAt = task.until;
    if (sim.pendingBlue) {
      sim.pendingBlue = false;
      sim.waitUntil = task.until + BLUE_WAIT_MS;
    }
    return;
  }
}

// The far end of the ramp from node, once the robot has stood on either end
// of it (it can see the ramp from there), else -1.
function rampLink(sim, node) {
  const { ramp } = sim.field;
  if (!ramp || !(sim.visited.has(ramp.from) || sim.visited.has(ramp.to))) return -1;
  if (node === ramp.from) return ramp.to;
  if (node === ramp.to) return ramp.from;
  return -1;
}

// Breadth-first search over edges the robot knows are open, on the current
// level only unless crossLevels lets it use the ramp.
function route(sim, from, isGoal, crossLevels) {
  const previous = new Map([[from, -1]]);
  const queue = [from];
  const visit = (next, node) => {
    if (next >= 0 && !previous.has(next) && !sim.black.has(next)) {
      previous.set(next, node);
      queue.push(next);
    }
  };
  while (queue.length) {
    const node = queue.shift();
    if (node !== from && isGoal(node)) {
      const path = [];
      for (let at = node; at !== from; at = previous.get(at)) path.unshift(at);
      return path;
    }
    for (let dir = 0; dir < 4; dir++) {
      if (knownAt(sim, node)[dir] === false) visit(neighbourNode(sim.field, node, dir), node);
    }
    if (crossLevels) visit(rampLink(sim, node), node);
  }
  return null;
}

// Frontier choice: the nearest unvisited node on the current level; only when
// none is reachable there, the nearest one anywhere (through the ramp). With no
// frontier left, return to the start across levels.
function nextNode(sim) {
  const start = sim.field.start;
  if (sim.phase === "EXPLORING") {
    const unvisited = node => !sim.visited.has(node);
    const path = route(sim, sim.pos, unvisited, false) || route(sim, sim.pos, unvisited, true);
    if (path) return path[0];
    sim.phase = "RETURNING";
    sim.route = sim.pos === start ? [] : route(sim, sim.pos, node => node === start, true) || [];
  }
  if (sim.phase === "RETURNING") {
    if (sim.route.length) return sim.route.shift();
    sim.phase = "COMPLETE";
    sim.hold = 0;
  }
  return -1;
}

// Random-walk the gyro drift while the robot drives straight. Steps are taken per
// DRIFT_TICK_MS of straight-line time (not per slice), so the result does not
// depend on how the elapsed time was sliced.
function walkDrift(sim, move, dt) {
  const lo = Math.max(sim.clock - dt, move.start + move.turn);
  const hi = Math.min(sim.clock, move.start + move.duration);
  if (hi <= lo) return;
  sim.driftAcc += hi - lo;
  while (sim.driftAcc >= DRIFT_TICK_MS) {
    sim.driftAcc -= DRIFT_TICK_MS;
    const next = sim.drift + (sim.driftRand() * 2 - 1) * DRIFT_STEP;
    sim.drift = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, next));
  }
}

// Heading in radians as drawn: swept through a turn, exact otherwise.
function angleNow(sim) {
  const move = sim.step;
  if (!move) return sim.angle;
  const turnT = move.turn ? Math.min(1, (sim.clock - move.start) / move.turn) : 1;
  return move.fromAngle + (move.toAngle - move.fromAngle) * ease(turnT);
}

function gyroDegrees(sim) {
  const degrees = (angleNow(sim) * 180) / Math.PI + sim.drift;
  return ((degrees % 360) + 360) % 360;
}

// One slice of at most MAX_TICK. The gyro reading is refreshed after every
// slice, whatever the robot was doing.
function update(sim, dt, realDt) {
  advance(sim, dt, realDt);
  sim.gyro = gyroDegrees(sim);
}

// dt is simulated time (scaled by the speed control); realDt is wall time, so
// the finished-run hold and fade last as long at any speed. When the FADE phase
// has outlasted FADE_MS the caller starts the next run (sim.hold > FADE_MS).
function advance(sim, dt, realDt) {
  if (sim.phase === "COMPLETE" || sim.phase === "FADE") {
    sim.hold += realDt;
    if (sim.phase === "COMPLETE" && sim.hold > HOLD_MS) {
      sim.phase = "FADE";
      sim.hold = 0;
    }
    return;
  }

  const sliceStart = sim.clock;
  sim.clock += dt;
  sim.runTime += dt;

  // Every event is timed from the exact end of the one before it (not from the
  // slice it was noticed in), so nothing idles and slicing changes nothing.
  // A move is at least STEP_MS > MAX_TICK, so this loops at most twice.
  for (;;) {
    if (!advanceOnce(sim, dt, sliceStart)) return;
  }
}

// Run tasks, waits and the current move up to sim.clock. Returns true when a
// move finished inside the slice, so the next one can start right away.
function advanceOnce(sim, dt, sliceStart) {
  // Identifying a victim or dropping kits.
  if (sim.task) {
    runTask(sim);
    if (sim.task) return false;
  }

  // Parked on a blue tile.
  if (sim.clock < sim.waitUntil) return false;

  if (!sim.step) {
    const to = nextNode(sim);
    if (to < 0) return false;
    const start = Math.max(sliceStart, sim.readyAt, sim.waitUntil);
    // The ramp edge faces ramp.dir going up and the opposite way going down;
    // the robot drives it facing that way and arrives still facing it.
    const { dir, ramp } = neighbours(sim.field, sim.pos).find(edge => edge.node === to);
    const turn = dir !== sim.heading ? TURN_MS : 0;
    let delta = dir - sim.heading;
    if (delta > 2) delta -= 4;
    if (delta < -2) delta += 4;
    const tile = levelAt(sim, to).tiles[cellOf(to)];
    // Heading onto a black tile turns into a probe: in, trip, back out.
    const probe = tile === "black";
    const debris = tile === "debris";
    const drive = ramp ? RAMP_MS : probe ? STEP_MS * 1.6 : debris ? DEBRIS_MS : STEP_MS;
    sim.step = {
      from: sim.pos,
      to,
      dir,
      probe,
      ramp,
      debris,
      tripped: false,
      fromAngle: sim.angle,
      toAngle: sim.angle + delta * (Math.PI / 2),
      start,
      turn,
      duration: turn + drive
    };
    if (ramp) {
      // The view cross-fade is centred on the arrival, so the level switch
      // happens with both levels half drawn.
      sim.resumePhase = sim.phase;
      sim.phase = "RAMP";
      sim.levelFade = {
        from: levelOf(sim.pos),
        to: levelOf(to),
        start: start + sim.step.duration - LEVEL_FADE_MS / 2
      };
    }
    // The gyro is re-referenced through a turn: drift starts again from zero.
    if (turn) {
      sim.drift = 0;
      sim.driftAcc = 0;
    }
  }

  const move = sim.step;
  const elapsed = sim.clock - move.start;
  walkDrift(sim, move, dt);
  if (move.probe && !move.tripped && elapsed >= move.turn + (move.duration - move.turn) / 2) {
    move.tripped = true;
    sim.black.add(move.to);
  }
  if (elapsed < move.duration) return false;
  const end = move.start + move.duration;
  sim.heading = move.dir;
  sim.angle = move.toAngle;
  sim.step = null;
  sim.readyAt = end;
  if (move.ramp) {
    sim.phase = sim.resumePhase;
    sim.resumePhase = null;
    sim.rampTraversals++;
  }
  if (!move.probe) arrive(sim, move.to, end);
  return true;
}

// Advance by dtMs of simulated time, in slices of at most MAX_TICK so fast
// speeds skip nothing. realDtMs (default dtMs) is the matching wall time.
export function step(sim, dtMs, realDtMs = dtMs) {
  let remaining = dtMs;
  while (remaining > 0) {
    const slice = Math.min(MAX_TICK, remaining);
    update(sim, slice, dtMs > 0 ? slice * (realDtMs / dtMs) : 0);
    remaining -= slice;
  }
}

const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Robot pose in tile units (cell centre = col + 0.5) on pose.level, interpolated
// mid-step, all driven by sim.clock. wobble: lateral offset in tiles (debris
// entry, else 0). climb: 0-1 progress while on the ramp, else null. On the ramp
// the robot drives RAMP_TRAVEL tiles along its tile, then (at the arrival)
// pose.level and x/y switch to the far end. levelFade: { from, to, t } with t
// 0-1 over LEVEL_FADE_MS, centred on that switch, else null.
export function pose(sim) {
  const move = sim.step;
  const at = node => {
    const size = levelAt(sim, node).size;
    const cell = cellOf(node);
    return [cell % size, Math.floor(cell / size)];
  };
  const fade = sim.levelFade;
  const since = fade ? sim.clock - fade.start : -1;
  const levelFade = since >= 0 && since < LEVEL_FADE_MS
    ? { from: fade.from, to: fade.to, t: since / LEVEL_FADE_MS }
    : null;
  if (!move) {
    const [x, y] = at(sim.pos);
    return { level: levelOf(sim.pos), x: x + 0.5, y: y + 0.5, angle: sim.angle, wobble: 0, climb: null, levelFade };
  }
  const elapsed = sim.clock - move.start;
  const moveT = Math.max(0, Math.min(1, (elapsed - move.turn) / (move.duration - move.turn)));
  const angle = angleNow(sim);
  const [fx, fy] = at(move.from);
  if (move.ramp) {
    const [dx, dy] = DIRS[move.dir];
    const m = RAMP_TRAVEL * ease(moveT);
    return { level: levelOf(move.from), x: fx + dx * m + 0.5, y: fy + dy * m + 0.5, angle, wobble: 0, climb: moveT, levelFade };
  }
  const m = move.probe
    ? PROBE_DEPTH * ease(moveT < 0.5 ? moveT * 2 : (1 - moveT) * 2)
    : ease(moveT);
  const [tx, ty] = at(move.to);
  return {
    level: levelOf(move.from),
    x: fx + (tx - fx) * m + 0.5,
    y: fy + (ty - fy) * m + 0.5,
    angle,
    wobble: move.debris ? WOBBLE * Math.sin(2 * Math.PI * 2 * moveT) : 0,
    climb: null,
    levelFade
  };
}

// HUD state label: FADE reads as COMPLETE.
export function stateLabel(sim) {
  if (sim.phase === "IDENTIFY" || sim.phase === "KIT DROP" || sim.phase === "RAMP") return sim.phase;
  const phase = sim.phase === "FADE" ? "COMPLETE" : sim.phase;
  if (sim.step && sim.step.probe && sim.step.tripped) return "BLACK TILE";
  if (phase !== "COMPLETE" && sim.clock < sim.waitUntil) return "BLUE STOP";
  return phase;
}

// Gyro heading for the HUD: three integer digits, one decimal ('090.4°').
export function formatHeading(deg) {
  const tenths = Math.round((((deg % 360) + 360) % 360) * 10) % 3600;
  return `${String(Math.floor(tenths / 10)).padStart(3, "0")}.${tenths % 10}°`;
}

// Render-time jitter in [-1, 1): a pure hash of (time, index) so the display noise
// never consumes a PRNG stream the simulation depends on.
export function displayJitter(at, index) {
  let h = Math.imul((Math.floor(at) | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}

// A beam's drawn length factor, 1 ± 3%. Display only; classification uses beam.hit.
export function beamScale(sim, index) {
  return 1 + 0.03 * displayJitter(sim.senseAt, index);
}

// Front ToF reading in mm for the HUD (tiles × 300, ±3% display noise).
export function frontMm(sim) {
  const front = sim.beams[0];
  return front ? Math.round(front.tiles * MM_PER_TILE * beamScale(sim, 0)) : 0;
}
