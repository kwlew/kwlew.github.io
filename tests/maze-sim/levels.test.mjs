import { test } from "node:test";
import assert from "node:assert/strict";
import { generateField, neighbours, levelOf, cellOf, neighbourNode, OPPOSITE } from "../../assets/js/maze-sim/maze.js";
import {
  createSim, step, pose, stateLabel, PHASES, STEP_MS, RAMP_MS, LEVEL_FADE_MS, MAX_TICK, BODY, BODY_SWELL
} from "../../assets/js/maze-sim/robot.js";
import { score, POINTS } from "../../assets/js/maze-sim/scoring.js";

const isBlack = (field, node) => field.levels[levelOf(node)].tiles[cellOf(node)] === "black";
const tileOf = (field, node) => field.levels[levelOf(node)].tiles[cellOf(node)];

function runToComplete(sim, dt = 50, limit = 20000) {
  let steps = 0;
  while (sim.phase !== "COMPLETE" && steps < limit) {
    step(sim, dt);
    steps++;
  }
  return steps;
}

// Step in 10 ms slices until a ramp step begins (or the run ends).
function untilRamp(sim) {
  let guard = 0;
  while (!(sim.step && sim.step.ramp) && sim.phase !== "COMPLETE" && guard++ < 100000) step(sim, 10);
  return sim.step && sim.step.ramp ? sim.step : null;
}

test("timing constants", () => {
  assert.equal(RAMP_MS, 2.5 * STEP_MS);
  assert.equal(LEVEL_FADE_MS, 400);
  assert.ok(PHASES.includes("RAMP"));
});

test("seeds 1..200 explore both levels via the ramp and finish on start", () => {
  let maxSteps = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    const path = [sim.pos];
    let steps = 0;
    while (sim.phase !== "COMPLETE" && steps < 20000) {
      const before = sim.pos;
      step(sim, 50);
      steps++;
      if (sim.pos !== before) path.push(sim.pos);
    }
    maxSteps = Math.max(maxSteps, steps);
    assert.equal(sim.phase, "COMPLETE", `seed ${seed} completes within 20000 steps`);
    assert.equal(sim.pos, field.start, `seed ${seed} ends on start`);
    assert.equal(sim.level, 0, `seed ${seed} ends on level 0`);
    assert.ok(sim.rampTraversals >= 2, `seed ${seed} ramp traversals ${sim.rampTraversals}`);

    // Every non-black node on both levels reachable from the start (through the ramp) was visited.
    const reached = new Set([field.start]);
    const queue = [field.start];
    while (queue.length) {
      const node = queue.shift();
      for (const next of neighbours(field, node)) {
        if (reached.has(next.node) || isBlack(field, next.node)) continue;
        reached.add(next.node);
        queue.push(next.node);
      }
    }
    assert.ok([...reached].some(node => levelOf(node) === 1), `seed ${seed} level 1 reachable`);
    for (const node of reached) assert.ok(sim.visited.has(node), `seed ${seed} visited ${node}`);
    for (const node of sim.visited) assert.ok(!isBlack(field, node), `seed ${seed} never arrives on black`);

    // Every move follows an open edge or the ramp.
    for (let i = 1; i < path.length; i++) {
      assert.ok(
        neighbours(field, path[i - 1]).some(n => n.node === path[i]),
        `seed ${seed} move ${i} ${path[i - 1]} -> ${path[i]} follows an open edge`
      );
    }
  }
  assert.ok(maxSteps <= 20000);
});

test("the first ramp traversal starts only when level 0 has no reachable unvisited known node", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    const move = untilRamp(sim);
    assert.ok(move, `seed ${seed} reaches the ramp`);
    assert.equal(move.from, field.ramp.from, `seed ${seed} goes up first`);
    assert.equal(levelOf(move.to), 1);
    // BFS over known-open edges on level 0, avoiding known black tiles.
    const seen = new Set([move.from]);
    const queue = [move.from];
    while (queue.length) {
      const node = queue.shift();
      assert.ok(sim.visited.has(node), `seed ${seed}: level 0 node ${node} still unvisited when the ramp starts`);
      for (let dir = 0; dir < 4; dir++) {
        if (sim.known.get(node)?.[dir] !== false) continue;
        const next = neighbourNode(field, node, dir);
        if (next < 0 || seen.has(next) || sim.black.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    assert.equal(sim.rampTraversals, 0);
  }
});

test("Review Focus 2: median runTime over seeds 1..50 is under 90 s", () => {
  const times = [];
  for (let seed = 1; seed <= 50; seed++) {
    const sim = createSim(generateField(seed));
    runToComplete(sim);
    assert.equal(sim.phase, "COMPLETE");
    times.push(sim.runTime);
  }
  times.sort((a, b) => a - b);
  const median = (times[24] + times[25]) / 2;
  assert.ok(median < 90000, `median runTime ${median}`);
});

test("Review Focus 3: pose is continuous through a ramp traversal and the fade is monotonic", () => {
  for (const seed of [1, 2, 3, 9, 40]) {
    const field = generateField(seed);
    const sim = createSim(field);
    for (let traversal = 0; traversal < 2; traversal++) {
      const move = untilRamp(sim);
      assert.ok(move, `seed ${seed} traversal ${traversal}`);
      const from = levelOf(move.from);
      const to = levelOf(move.to);
      const end = move.start + move.duration;
      assert.equal(move.duration - move.turn, RAMP_MS);
      assert.equal(sim.phase, "RAMP");
      assert.equal(stateLabel(sim), "RAMP");
      assert.equal(move.dir, traversal === 0 ? field.ramp.dir : OPPOSITE[field.ramp.dir]);

      let prev = pose(sim);
      let switches = 0;
      let fadeSeen = 0;
      while (sim.clock < end + LEVEL_FADE_MS) {
        step(sim, 10);
        const p = pose(sim);
        assert.deepEqual(pose(sim), p, "pose is a pure read of the sim");
        if (p.level === prev.level) {
          assert.ok(Math.abs(p.x - prev.x) <= 0.2, `seed ${seed} x jump ${prev.x} -> ${p.x}`);
          assert.ok(Math.abs(p.y - prev.y) <= 0.2, `seed ${seed} y jump ${prev.y} -> ${p.y}`);
        } else {
          // The only level switch is the arrival, hidden mid-way through the cross-fade.
          switches++;
          assert.equal(prev.level, from);
          assert.equal(p.level, to);
          assert.equal(sim.clock, end);
          assert.ok(p.levelFade && Math.abs(p.levelFade.t - 0.5) < 0.05, `fade t at switch ${p.levelFade?.t}`);
        }
        if (p.climb !== null && prev.climb !== null) {
          assert.ok(Math.abs(p.climb - prev.climb) <= 0.1, `climb jump ${prev.climb} -> ${p.climb}`);
        }
        if (p.climb !== null) assert.ok(p.climb >= 0 && p.climb <= 1);
        if (p.levelFade) {
          fadeSeen++;
          assert.deepEqual([p.levelFade.from, p.levelFade.to], [from, to]);
          assert.ok(p.levelFade.t >= 0 && p.levelFade.t <= 1);
          if (prev.levelFade) assert.ok(p.levelFade.t > prev.levelFade.t, "fade t increases");
          else assert.ok(p.levelFade.t <= 10 / LEVEL_FADE_MS + 1e-9, "fade starts at t = 0");
        } else if (prev.levelFade) {
          assert.ok(prev.levelFade.t >= 1 - 10 / LEVEL_FADE_MS - 1e-9, "fade only ends at t = 1");
        }
        if (sim.clock >= end) assert.equal(p.climb, null, "climb is null once off the ramp");
        prev = p;
      }
      assert.equal(switches, 1, `seed ${seed} switches level once`);
      assert.ok(fadeSeen >= LEVEL_FADE_MS / 10 - 1, `fade lasts LEVEL_FADE_MS (${fadeSeen} samples)`);
      assert.equal(pose(sim).levelFade, null);
      assert.equal(sim.level, to);
      assert.equal(sim.rampTraversals, traversal + 1);
    }
  }
});

test("the robot body stays inside the ramp cell through every traversal (seeds 1..200)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    for (let traversal = 0; traversal < 2; traversal++) {
      const move = untilRamp(sim);
      assert.ok(move, `seed ${seed} traversal ${traversal}`);
      const end = move.start + move.duration;
      const cell = cellOf(move.from);
      const size = field.levels[levelOf(move.from)].size;
      const cx = (cell % size) + 0.5;
      const cy = Math.floor(cell / size) + 0.5;
      while (sim.step === move) {
        const p = pose(sim);
        if (p.climb !== null) {
          const half = (BODY * (1 + BODY_SWELL * Math.sin(Math.PI * p.climb))) / 2;
          const reach = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)) + half;
          assert.ok(reach <= 0.5, `seed ${seed} traversal ${traversal} body reaches ${reach.toFixed(3)} tiles from the ramp cell centre`);
        }
        step(sim, 10);
        if (sim.clock > end + 50) break;
      }
    }
  }
});

test("a ramp traversal paused in the middle resumes to the same state (sim clock only)", () => {
  const a = createSim(generateField(5));
  const b = createSim(generateField(5));
  const move = untilRamp(a);
  untilRamp(b);
  const half = move.turn + 0.7 * RAMP_MS; // past the start of the cross-fade
  step(a, half);
  const mid = pose(a);
  assert.ok(mid.climb > 0 && mid.climb < 1);
  assert.ok(mid.levelFade && mid.levelFade.t > 0 && mid.levelFade.t < 0.5, "mid-ramp is also mid-fade");
  // A pause never reaches the sim: nothing changes until it is stepped again.
  assert.deepEqual(pose(a), mid);
  // Same simulated time with very different wall time (a long hidden-tab gap,
  // or none): motion, climb and fade follow sim.clock only.
  step(b, half, 0);
  assert.deepEqual(pose(b), mid);
  for (let i = 0; i < 40; i++) {
    step(a, 25, 25);
    step(b, 25, i % 2 ? 60000 : 0);
    assert.deepEqual(pose(b), pose(a));
  }
  assert.equal(b.pos, a.pos);
  assert.equal(b.level, a.level);
  assert.equal(b.gyro, a.gyro);
  assert.equal(a.rampTraversals, 1);
});

test("gyro follows the heading through ramp traversals", () => {
  const field = generateField(3);
  const sim = createSim(field);
  const angularGap = (x, y) => Math.abs(((x - y + 540) % 360 + 360) % 360 - 180);
  let rampSamples = 0;
  for (let guard = 0; guard < 100000 && sim.phase !== "COMPLETE"; guard++) {
    step(sim, 10);
    const move = sim.step;
    if (move && sim.clock - move.start < move.turn) continue;
    const heading = move ? move.dir : sim.heading;
    if (move && move.ramp) rampSamples++;
    assert.ok(angularGap(sim.gyro, heading * 90 + sim.drift) < 1e-6, `gyro ${sim.gyro} heading ${heading}`);
  }
  assert.ok(rampSamples > 0);
  assert.equal(sim.phase, "COMPLETE");
});

test("arriving off the ramp faces the edge direction: up = ramp.dir, down = opposite", () => {
  const field = generateField(9);
  const sim = createSim(field);
  for (const expected of [field.ramp.dir, OPPOSITE[field.ramp.dir]]) {
    const move = untilRamp(sim);
    while (sim.step === move) step(sim, 10);
    assert.equal(sim.heading, expected);
    assert.equal(sim.pos, move.to);
    assert.equal(pose(sim).angle, sim.angle);
    assert.ok(Math.abs(((sim.angle / (Math.PI / 2)) % 4 + 4) % 4 - expected) < 1e-9);
  }
});

test("entering a debris cell takes 2 x STEP_MS with a wobble of at most 0.04 tiles", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 6; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    for (let guard = 0; guard < 100000 && sim.phase !== "COMPLETE" && checked < 6; guard++) {
      step(sim, 10);
      const move = sim.step;
      if (!move) {
        assert.equal(pose(sim).wobble, 0);
        continue;
      }
      if (tileOf(field, move.to) !== "debris" || move.probe || sim.clock !== move.start) {
        if (tileOf(field, move.to) !== "debris") assert.equal(pose(sim).wobble, 0);
        continue;
      }
      // First sample of a debris entry.
      assert.equal(move.duration - move.turn, 2 * STEP_MS);
      let maxWobble = 0;
      while (sim.clock < move.start + move.duration - 10) {
        assert.equal(sim.pos, move.from, "still on the way in");
        assert.ok(["EXPLORING", "RETURNING"].includes(sim.phase));
        const { wobble } = pose(sim);
        assert.ok(Math.abs(wobble) <= 0.04 + 1e-12, `wobble ${wobble}`);
        maxWobble = Math.max(maxWobble, Math.abs(wobble));
        step(sim, 10);
      }
      assert.equal(sim.pos, move.from, "10 ms before the end");
      step(sim, 10);
      assert.equal(sim.pos, move.to, "arrived after exactly 2 x STEP_MS");
      assert.ok(maxWobble > 0.03, `wobble moves (${maxWobble})`);
      checked++;
    }
  }
  assert.ok(checked >= 3, `debris entries checked: ${checked}`);
});

test("score at COMPLETE includes RAMP x rampTraversals", () => {
  for (const seed of [1, 7, 20]) {
    const sim = createSim(generateField(seed));
    runToComplete(sim);
    assert.equal(sim.phase, "COMPLETE");
    const identified = sim.identified.size;
    const kits = sim.kits.reduce((a, b) => a + b, 0);
    assert.ok(sim.rampTraversals >= 2);
    assert.equal(
      score(sim),
      POINTS.VICTIM_ID * identified + POINTS.KIT * kits + POINTS.RAMP * sim.rampTraversals + POINTS.EXIT_BONUS_PER_VICTIM * identified
    );
  }
});

test("victims on both levels are identified with global indices (level 0 first)", () => {
  for (const seed of [1, 7, 20]) {
    const field = generateField(seed);
    const sim = createSim(field);
    runToComplete(sim);
    const all = [...field.levels[0].victims, ...field.levels[1].victims];
    assert.equal(sim.kits.length, all.length);
    assert.equal(sim.found.size, all.length);
    assert.equal(sim.identified.size, all.length);
  }
});

test("event timing: the run is the same whatever the slice size", () => {
  const snap = sim => ({
    pos: sim.pos, phase: sim.phase, level: sim.level, rampTraversals: sim.rampTraversals,
    pose: pose(sim), gyro: sim.gyro, drift: sim.drift, black: [...sim.black],
    identified: [...sim.identified], kits: [...sim.kits], trail: sim.trail.length, senseAt: sim.senseAt
  });
  for (const seed of [2, 9]) {
    const sims = [10, 30, 50].map(dt => ({ dt, sim: createSim(generateField(seed)) }));
    for (let t = 150; t <= 120000; t += 150) {
      for (const s of sims) while (s.sim.clock < t && s.sim.phase !== "COMPLETE") step(s.sim, s.dt);
      const [a, ...rest] = sims.map(s => snap(s.sim));
      for (const b of rest) assert.deepEqual(b, a, `seed ${seed} at ${t} ms`);
      if (a.phase === "COMPLETE") break;
    }
  }
});
