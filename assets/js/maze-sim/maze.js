// Maze generation. Pure, DOM-free.
//
// A node id names one cell on one level: level * 128 + cell. On level 0 the
// node id is the cell index.
import { mulberry32 } from "./rng.js?v=10";

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W
export const OPPOSITE = [2, 3, 0, 1];
export const LEVEL_STRIDE = 128;

const N = 9;
const N2 = 7;                           // level 2 is 7x7
const EXTRA_OPENINGS = 0.12;            // share of interior walls removed to create loops
const BLACK_TILES = 4;
const BLUE_TILES = 3;
const BLACK_TILES_2 = 2;
const BLUE_TILES_2 = 1;
const DEBRIS_TILES = 3;                 // across both levels
const MIN_RAMP_RUN = 3;                 // least horizontal distance between the ramp ends, tiles

export function nodeId(level, cell) {
  return level * LEVEL_STRIDE + cell;
}

export const levelOf = node => Math.floor(node / LEVEL_STRIDE);
export const cellOf = node => node % LEVEL_STRIDE;

// Neighbouring node on the same level in direction dir, or -1 off the edge.
export function neighbourNode(field, node, dir) {
  const level = levelOf(node);
  const size = field.levels[level].size;
  const cell = cellOf(node);
  const x = (cell % size) + DIRS[dir][0];
  const y = Math.floor(cell / size) + DIRS[dir][1];
  return x >= 0 && x < size && y >= 0 && y < size ? nodeId(level, y * size + x) : -1;
}

// Open-edge neighbours of a node, plus the ramp edge. Black tiles are not
// filtered here: the robot decides what it is willing to enter.
export function neighbours(field, node) {
  const level = field.levels[levelOf(node)];
  const cell = cellOf(node);
  const result = [];
  for (let dir = 0; dir < 4; dir++) {
    if (level.walls[cell][dir]) continue;
    const next = neighbourNode(field, node, dir);
    if (next >= 0) result.push({ node: next, dir, ramp: false });
  }
  const { ramp } = field;
  if (ramp) {
    if (node === ramp.from) result.push({ node: ramp.to, dir: ramp.dir, ramp: true });
    else if (node === ramp.to) result.push({ node: ramp.from, dir: OPPOSITE[ramp.dir], ramp: true });
  }
  return result;
}

// Recursive backtracker (iterative) giving a perfect maze, then a share of
// interior walls knocked out so there are loops to reason about.
function carve(field, level, rand, startCell) {
  const { size, walls } = field.levels[level];
  const open = (node, dir) => {
    walls[cellOf(node)][dir] = false;
    walls[cellOf(neighbourNode(field, node, dir))][OPPOSITE[dir]] = false;
  };
  const seen = new Array(size * size).fill(false);
  const stack = [nodeId(level, startCell)];
  seen[startCell] = true;
  while (stack.length) {
    const node = stack[stack.length - 1];
    const options = [0, 1, 2, 3].filter(dir => {
      const next = neighbourNode(field, node, dir);
      return next >= 0 && !seen[cellOf(next)];
    });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const dir = options[Math.floor(rand() * options.length)];
    const next = neighbourNode(field, node, dir);
    open(node, dir);
    seen[cellOf(next)] = true;
    stack.push(next);
  }

  const interior = [];
  for (let cell = 0; cell < size * size; cell++) {
    for (const dir of [1, 2]) {
      if (neighbourNode(field, nodeId(level, cell), dir) >= 0 && walls[cell][dir]) interior.push([cell, dir]);
    }
  }
  for (let i = 0; i < Math.round(interior.length * EXTRA_OPENINGS); i++) {
    const pick = i + Math.floor(rand() * (interior.length - i));
    [interior[i], interior[pick]] = [interior[pick], interior[i]];
    open(nodeId(level, interior[i][0]), interior[i][1]);
  }
}

// Fisher-Yates over every cell of a level.
function shuffledCells(size, rand) {
  const order = Array.from({ length: size * size }, (_, cell) => cell);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Victims sit on a wall of a random cell, never in `used` or on a hole.
function placeVictims(field, level, rand, count, used) {
  const { size, walls, tiles, victims } = field.levels[level];
  while (victims.length < count) {
    const cell = Math.floor(rand() * size * size);
    if (used.has(cell) || tiles[cell] === "black") continue;
    const sides = [0, 1, 2, 3].filter(dir => walls[cell][dir]);
    if (!sides.length) continue;
    used.add(cell);
    victims.push({ node: nodeId(level, cell), dir: sides[Math.floor(rand() * sides.length)] });
  }
}

// Every non-black tile on every level is reachable from the start, so a run
// can always be completed.
function allReachable(field) {
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
  const total = field.levels.reduce((n, level) => n + level.tiles.filter(tile => tile !== "black").length, 0);
  return reached.size === total;
}

export function generateField(seed) {
  const START = (N - 1) * N;            // bottom-left cell
  const level1 = {
    size: N,
    walls: Array.from({ length: N * N }, () => [true, true, true, true]),
    tiles: new Array(N * N).fill("floor"),
    victims: [],
    debrisDots: {}
  };
  const field = { seed, levels: [level1], start: nodeId(0, START), ramp: null };
  const { walls, tiles, victims } = level1;

  // Level 1 consumes the main stream exactly as the original generator did.
  const rand = mulberry32(seed);
  carve(field, 0, rand, START);

  const blackCount = () => tiles.filter(tile => tile === "black").length;
  const order = shuffledCells(N, rand);
  for (const cell of order) {
    if (blackCount() >= BLACK_TILES) break;
    if (cell === START) continue;
    tiles[cell] = "black";
    if (!allReachable(field)) tiles[cell] = "floor";
  }
  let blue = 0;
  for (const cell of order.slice().reverse()) {
    if (blue >= BLUE_TILES) break;
    if (cell === START || tiles[cell] !== "floor") continue;
    tiles[cell] = "blue";
    blue++;
  }

  const count = 3 + Math.floor(rand() * 2);
  placeVictims(field, 0, rand, count, new Set([START]));

  // Level 2, the ramp and debris come from their own stream so level 1 stays
  // identical to the parity fixture.
  const rand2 = mulberry32(seed ^ 0x85ebca6b);
  const level2 = {
    size: N2,
    walls: Array.from({ length: N2 * N2 }, () => [true, true, true, true]),
    tiles: new Array(N2 * N2).fill("floor"),
    victims: [],
    debrisDots: {}
  };
  field.levels.push(level2);
  carve(field, 1, rand2, Math.floor(rand2() * N2 * N2));

  const count2 = 1 + Math.floor(rand2() * 2);
  const used2 = new Set();
  placeVictims(field, 1, rand2, count2, used2);

  // Ramp: a floor cell on level 1 (not start, no victim) to a floor cell on
  // level 2 with no victim. Both tiles are exclusive to the ramp.
  const hasVictim = (level, cell) => field.levels[level].victims.some(v => cellOf(v.node) === cell);
  const fromCells = [];
  for (let cell = 0; cell < N * N; cell++) {
    if (cell !== START && tiles[cell] === "floor" && !hasVictim(0, cell)) fromCells.push(cell);
  }
  const toCells = [];
  for (let cell = 0; cell < N2 * N2; cell++) if (!used2.has(cell)) toCells.push(cell);
  const from = fromCells[Math.floor(rand2() * fromCells.length)];
  // Keep the ramp's horizontal run (in centred world tiles) long enough that the
  // 3D view's slope stays gentle; fall back to the farthest cells if none is.
  const worldAt = (cell, size) => [(cell % size) - (size - 1) / 2, Math.floor(cell / size) - (size - 1) / 2];
  const [fromX, fromZ] = worldAt(from, N);
  const runTo = cell => {
    const [x, z] = worldAt(cell, N2);
    return Math.hypot(x - fromX, z - fromZ);
  };
  const farEnough = toCells.filter(cell => runTo(cell) >= MIN_RAMP_RUN);
  const farthest = Math.max(...toCells.map(runTo));
  const toPool = farEnough.length ? farEnough : toCells.filter(cell => runTo(cell) === farthest);
  const to = toPool[Math.floor(rand2() * toPool.length)];
  tiles[from] = "ramp";
  level2.tiles[to] = "ramp";
  field.ramp = { from: nodeId(0, from), to: nodeId(1, to), dir: Math.floor(rand2() * 4) };

  const black2 = () => level2.tiles.filter(tile => tile === "black").length;
  const order2 = shuffledCells(N2, rand2);
  for (const cell of order2) {
    if (black2() >= BLACK_TILES_2) break;
    if (level2.tiles[cell] !== "floor" || used2.has(cell)) continue;
    level2.tiles[cell] = "black";
    if (!allReachable(field)) level2.tiles[cell] = "floor";
  }
  let blue2 = 0;
  for (const cell of order2.slice().reverse()) {
    if (blue2 >= BLUE_TILES_2) break;
    if (level2.tiles[cell] !== "floor") continue;
    level2.tiles[cell] = "blue";
    blue2++;
  }

  // Debris on plain floor of either level, never the start or the ramp.
  const candidates = [];
  field.levels.forEach((level, l) => {
    level.tiles.forEach((tile, cell) => {
      if (tile === "floor" && !(l === 0 && cell === START)) candidates.push([l, cell]);
    });
  });
  for (let i = 0; i < DEBRIS_TILES; i++) {
    const pick = i + Math.floor(rand2() * (candidates.length - i));
    [candidates[i], candidates[pick]] = [candidates[pick], candidates[i]];
    const [l, cell] = candidates[i];
    const level = field.levels[l];
    level.tiles[cell] = "debris";
    level.debrisDots[cell] = Array.from({ length: 4 + Math.floor(rand2() * 3) }, () => ({ x: rand2(), y: rand2() }));
  }

  // Victim types come from their own stream, level 1 victims first.
  const typeRand = mulberry32(seed ^ 0x5bd1e995);
  const LETTERS = ["H", "S", "U"];
  const COLORS = ["red", "yellow", "green"];
  for (const victim of [...victims, ...level2.victims]) {
    const group = typeRand() < 0.5 ? LETTERS : COLORS;
    victim.type = group[Math.floor(typeRand() * group.length)];
  }

  return field;
}
