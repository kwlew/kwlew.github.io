import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToWorld } from "../../assets/js/maze-sim/scene3d-model.js";
import { generateField, neighbours, nodeId, levelOf, cellOf, DIRS, OPPOSITE } from "../../assets/js/maze-sim/maze.js";

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);
const count = (tiles, kind) => tiles.filter(tile => tile === kind).length;

test("a field has two levels of 9x9 and 7x7 and a ramp", () => {
  const field = generateField(1);
  assert.equal(field.levels.length, 2);
  assert.equal(field.levels[0].size, 9);
  assert.equal(field.levels[1].size, 7);
  assert.equal(field.levels[0].tiles.length, 81);
  assert.equal(field.levels[1].tiles.length, 49);
  assert.equal(field.levels[1].walls.length, 49);
  assert.ok([0, 1, 2, 3].includes(field.ramp.dir));
});

test("every non-black cell on both levels is reachable from start via neighbours", () => {
  for (const seed of SEEDS) {
    const field = generateField(seed);
    const isBlack = node => field.levels[levelOf(node)].tiles[cellOf(node)] === "black";
    const reached = new Set([field.start]);
    const queue = [field.start];
    while (queue.length) {
      const node = queue.shift();
      for (const next of neighbours(field, node)) {
        if (reached.has(next.node) || isBlack(next.node)) continue;
        reached.add(next.node);
        queue.push(next.node);
      }
    }
    const total = field.levels.reduce((n, level) => n + level.tiles.filter(t => t !== "black").length, 0);
    assert.equal(reached.size, total, `seed ${seed}`);
  }
});

test("neighbours returns open edges plus the ramp edge, symmetric", () => {
  for (const seed of [1, 2, 3, 40, 200]) {
    const field = generateField(seed);
    const { ramp } = field;
    const up = neighbours(field, ramp.from).filter(n => n.ramp);
    const down = neighbours(field, ramp.to).filter(n => n.ramp);
    assert.deepEqual(up.map(n => n.node), [ramp.to]);
    assert.deepEqual(down.map(n => n.node), [ramp.from]);
    for (let level = 0; level < 2; level++) {
      const { size, walls } = field.levels[level];
      for (let cell = 0; cell < size * size; cell++) {
        const node = nodeId(level, cell);
        const flat = neighbours(field, node).filter(n => !n.ramp);
        const open = [0, 1, 2, 3].filter(dir => !walls[cell][dir]
          && (cell % size) + DIRS[dir][0] >= 0 && (cell % size) + DIRS[dir][0] < size
          && Math.floor(cell / size) + DIRS[dir][1] >= 0 && Math.floor(cell / size) + DIRS[dir][1] < size);
        assert.deepEqual(flat.map(n => n.dir), open, `seed ${seed} node ${node}`);
        for (const n of flat) {
          assert.equal(levelOf(n.node), level);
          assert.ok(neighbours(field, n.node).some(b => b.node === node && b.dir === OPPOSITE[n.dir]));
        }
        if (node !== ramp.from && node !== ramp.to) assert.ok(neighbours(field, node).every(n => !n.ramp));
      }
    }
  }
});

test("ramp.from is on level 0, ramp.to on level 1, both tiles are ramp", () => {
  for (const seed of SEEDS) {
    const { levels, ramp } = generateField(seed);
    assert.equal(levelOf(ramp.from), 0, `seed ${seed}`);
    assert.equal(levelOf(ramp.to), 1, `seed ${seed}`);
    assert.equal(levels[0].tiles[cellOf(ramp.from)], "ramp");
    assert.equal(levels[1].tiles[cellOf(ramp.to)], "ramp");
    assert.equal(count(levels[0].tiles, "ramp"), 1);
    assert.equal(count(levels[1].tiles, "ramp"), 1);
  }
});

test("tile and victim counts per level", () => {
  for (const seed of SEEDS) {
    const [l1, l2] = generateField(seed).levels;
    assert.ok(count(l1.tiles, "black") <= 4, `seed ${seed} L1 black`);
    assert.equal(count(l1.tiles, "blue"), 3, `seed ${seed} L1 blue`);
    assert.ok(l1.victims.length >= 3 && l1.victims.length <= 4, `seed ${seed} L1 victims`);
    assert.equal(l2.size, 7);
    assert.ok(count(l2.tiles, "black") <= 2, `seed ${seed} L2 black`);
    assert.equal(count(l2.tiles, "blue"), 1, `seed ${seed} L2 blue`);
    assert.ok(l2.victims.length >= 1 && l2.victims.length <= 2, `seed ${seed} L2 victims`);
    assert.equal(count(l1.tiles, "debris") + count(l2.tiles, "debris"), 3, `seed ${seed} debris`);
  }
});

test("debris cells carry 4-6 dots in [0,1) and nothing else does", () => {
  for (const seed of SEEDS) {
    for (const level of generateField(seed).levels) {
      const debris = level.tiles.flatMap((tile, cell) => (tile === "debris" ? [cell] : []));
      assert.deepEqual(Object.keys(level.debrisDots).map(Number).sort((a, b) => a - b), debris, `seed ${seed}`);
      for (const cell of debris) {
        const dots = level.debrisDots[cell];
        assert.ok(dots.length >= 4 && dots.length <= 6, `seed ${seed} dots`);
        for (const d of dots) assert.ok(d.x >= 0 && d.x < 1 && d.y >= 0 && d.y < 1);
      }
    }
  }
});

test("tile exclusivity: start is floor, no victim on black or ramp, no shared victim cell", () => {
  for (const seed of SEEDS) {
    const field = generateField(seed);
    assert.equal(levelOf(field.start), 0);
    assert.equal(field.levels[0].tiles[cellOf(field.start)], "floor", `seed ${seed} start`);
    for (let level = 0; level < 2; level++) {
      const { tiles, victims } = field.levels[level];
      const seen = new Set();
      for (const v of victims) {
        assert.equal(levelOf(v.node), level, `seed ${seed} victim level`);
        assert.ok(!["black", "ramp"].includes(tiles[cellOf(v.node)]), `seed ${seed} victim tile`);
        assert.notEqual(v.node, field.start, `seed ${seed} victim on start`);
        assert.ok(!seen.has(v.node), `seed ${seed} two victims on a cell`);
        seen.add(v.node);
      }
    }
    assert.ok(!field.levels[0].victims.some(v => v.node === field.ramp.from));
    assert.ok(!field.levels[1].victims.some(v => v.node === field.ramp.to));
  }
});

test("every victim's dir side is a true wall", () => {
  for (const seed of SEEDS) {
    const field = generateField(seed);
    for (let level = 0; level < 2; level++) {
      for (const v of field.levels[level].victims) {
        assert.equal(field.levels[level].walls[cellOf(v.node)][v.dir], true, `seed ${seed}`);
      }
    }
  }
});

test("every victim has a valid type", () => {
  const types = ["H", "S", "U", "red", "yellow", "green"];
  for (const seed of SEEDS) {
    for (const level of generateField(seed).levels) for (const v of level.victims) assert.ok(types.includes(v.type));
  }
});

test("generation is deterministic", () => {
  assert.deepEqual(generateField(77), generateField(77));
});

test("the ramp ends are at least 3 tiles apart horizontally in world space", () => {
  for (const seed of SEEDS) {
    const field = generateField(seed);
    const a = cellToWorld(field, field.ramp.from);
    const b = cellToWorld(field, field.ramp.to);
    assert.ok(Math.hypot(b.x - a.x, b.z - a.z) >= 3, `seed ${seed}`);
  }
});
