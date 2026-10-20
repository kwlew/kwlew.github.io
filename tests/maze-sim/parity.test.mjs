import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateField } from "../../assets/js/maze-sim/maze.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/parity.json", import.meta.url), "utf8"));

test("generateField matches the old generator", () => {
  for (const f of fixture) {
    const field = generateField(f.seed);
    assert.deepEqual(field.levels[0].walls, f.walls, `walls, seed ${f.seed}`);
    // Task 7 stamps ramp and debris onto level 1 floor cells; the rest must match.
    assert.deepEqual(
      field.levels[0].tiles.map(tile => (tile === "ramp" || tile === "debris" ? "floor" : tile)),
      f.tiles,
      `tiles, seed ${f.seed}`
    );
    assert.deepEqual(
      field.levels[0].victims.map(v => [v.node, v.dir]),
      f.victims.map(v => [v.cell, v.dir]),
      `victims, seed ${f.seed}`
    );
  }
});
