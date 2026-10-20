import { test } from "node:test";
import assert from "node:assert/strict";
import { generateField, nodeId, levelOf, cellOf, neighbourNode } from "../../assets/js/maze-sim/maze.js";
import { createSim, step } from "../../assets/js/maze-sim/robot.js";
import { castBeams, applyBeams, TOF_RANGE_TILES } from "../../assets/js/maze-sim/sensors.js";

// A single open row (cells 0..size-1) of a size x size grid, walled all round.
function corridor(size) {
  const walls = Array.from({ length: size * size }, () => [true, true, true, true]);
  for (let x = 0; x < size; x++) {
    if (x > 0) walls[x][3] = false;
    if (x < size - 1) walls[x][1] = false;
  }
  return { seed: 0, levels: [{ size, walls, tiles: [], victims: [], debrisDots: {} }], start: 0, ramp: null };
}

test("TOF range is 4 tiles", () => {
  assert.equal(TOF_RANGE_TILES, 4);
});

test("beams measure distance to the wall from the cell centre", () => {
  const field = corridor(3);
  const beams = castBeams(field, 0, 1);
  assert.deepEqual(beams.map(b => b.dir), [1, 2, 3, 0]); // front, right, back, left
  assert.equal(beams[0].hit, true);
  assert.equal(beams[0].tiles, 2.5);
  assert.deepEqual(beams[0].passed, [0, 1, 1, 1]);
  assert.equal(beams[2].hit, true);
  assert.equal(beams[2].tiles, 0.5);
  assert.deepEqual(beams[2].passed, []);
});

test("beams are capped at the sensor range", () => {
  const field = corridor(9);
  const [front] = castBeams(field, 0, 1);
  assert.equal(front.hit, false);
  assert.equal(front.tiles, TOF_RANGE_TILES);
  assert.equal(front.passed.length, 2 * TOF_RANGE_TILES);
  // A wall just inside the range is still seen.
  const [near] = castBeams(field, 5, 1);
  assert.equal(near.hit, true);
  assert.equal(near.tiles, 3.5);
});

test("applyBeams marks passed edges open and hit walls closed on both sides", () => {
  const field = corridor(3);
  const known = new Map();
  applyBeams(known, castBeams(field, 0, 1), field);
  assert.equal(known.get(0)[1], false);
  assert.equal(known.get(1)[3], false);
  assert.equal(known.get(1)[1], false);
  assert.equal(known.get(2)[3], false);
  assert.equal(known.get(2)[1], true);
  assert.equal(known.get(0)[3], true);
  assert.equal(known.get(0)[0], true);
  assert.equal(known.get(3)[0], true); // neighbour below the open row sees the same wall
});

test("beams never contradict the maze, on either level", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const field = generateField(seed);
    const sim = createSim(field);
    const check = () => {
      for (const [node, sides] of sim.known) {
        const level = field.levels[levelOf(node)];
        assert.ok(level && cellOf(node) < level.size * level.size, `seed ${seed} known node ${node} exists`);
        sides.forEach((value, dir) => {
          if (value !== null) assert.equal(value, level.walls[cellOf(node)][dir], `seed ${seed} node ${node} dir ${dir}`);
        });
      }
    };
    check();
    for (let i = 0; i < 20000 && sim.phase !== "COMPLETE"; i++) {
      const before = sim.pos;
      step(sim, 50);
      if (sim.pos !== before) check();
    }
    assert.equal(sim.phase, "COMPLETE", `seed ${seed} completes`);
    assert.equal(sim.beams.length, 4);
    assert.ok([...sim.known.keys()].some(node => levelOf(node) === 1), `seed ${seed} mapped level 1`);
  }
});

test("a beam never leaves the grid or its level (all 130 nodes)", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const field = generateField(seed);
    let nodes = 0;
    field.levels.forEach((level, l) => {
      for (let cell = 0; cell < level.size * level.size; cell++) {
        const node = nodeId(l, cell);
        nodes++;
        for (let heading = 0; heading < 4; heading++) {
          for (const beam of castBeams(field, node, heading)) {
            assert.ok(beam.tiles > 0 && beam.tiles <= TOF_RANGE_TILES);
            assert.equal(beam.node, node);
            for (let i = 0; i < beam.passed.length; i += 2) {
              assert.equal(levelOf(beam.passed[i]), l, `seed ${seed} beam stays on level ${l}`);
              const next = neighbourNode(field, beam.passed[i], beam.passed[i + 1]);
              assert.ok(next >= 0);
              assert.equal(levelOf(next), l);
            }
          }
        }
      }
    });
    assert.equal(nodes, 130);
  }
});

test("a beam cast from a ramp tile does not follow the ramp", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const field = generateField(seed);
    for (const node of [field.ramp.from, field.ramp.to]) {
      const other = node === field.ramp.from ? field.ramp.to : field.ramp.from;
      for (let heading = 0; heading < 4; heading++) {
        const beams = castBeams(field, node, heading);
        const known = new Map();
        applyBeams(known, beams, field);
        for (const beam of beams) {
          for (let i = 0; i < beam.passed.length; i += 2) assert.notEqual(beam.passed[i], other);
        }
        for (const key of known.keys()) assert.equal(levelOf(key), levelOf(node), `seed ${seed} maps only its own level`);
      }
    }
  }
});

test("the robot senses on every arrival", () => {
  const sim = createSim(generateField(7));
  let arrivals = 0;
  let last = sim.senseAt;
  for (let i = 0; i < 2000 && sim.phase !== "COMPLETE"; i++) {
    const before = sim.trail.length;
    step(sim, 50);
    if (sim.trail.length > before) {
      arrivals++;
      assert.ok(sim.senseAt > last);
      last = sim.senseAt;
    }
  }
  assert.ok(arrivals > sim.visited.size, "revisits happen and are sensed too");
});
