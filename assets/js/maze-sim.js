// Rescue Maze simulation for the landing hero.
//
// Each run generates a fresh thin-wall maze from a seed, then a robot that
// knows nothing about it explores cell by cell: on entering a cell it senses
// the four walls around it, flags any victim on those walls, and heads for
// the nearest unvisited cell reachable through walls it already knows are
// open (frontier exploration). With no frontier left it drives back to the
// start, holds, and a new maze begins. Only what the robot has sensed is
// drawn, so the map builds up the same way the real one does.
//
// Floor tiles follow the RoboCup Junior rules: a black tile is a hole the
// robot must not enter (its floor sensor trips on the edge, it backs out and
// never plans through that tile again), and a blue tile makes it stop for a
// moment every time it drives onto one.
(function () {
  "use strict";

  const canvas = document.getElementById("sim-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const out = {
    seed: document.getElementById("sim-seed"),
    run: document.getElementById("sim-run"),
    mapped: document.getElementById("sim-mapped"),
    victims: document.getElementById("sim-victims"),
    time: document.getElementById("sim-time"),
    state: document.getElementById("sim-state")
  };

  const N = 9;
  const START = (N - 1) * N;              // bottom-left cell
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W
  const OPPOSITE = [2, 3, 0, 1];
  const EXTRA_OPENINGS = 0.12;            // share of interior walls removed to create loops
  const STEP_MS = 200;
  const TURN_MS = 120;
  const SENSE_MS = 150;
  const HOLD_MS = 2500;
  const FADE_MS = 400;
  const TRAIL_FADE_MS = 9000;
  const BLACK_TILES = 4;
  const BLUE_TILES = 3;
  const BLUE_WAIT_MS = 1500;              // the real rule is a 5 s stop; scaled like the rest of the sim
  const PROBE_DEPTH = 0.38;               // how far onto a black tile the robot gets before backing out
  const MAX_TICK = 50;                    // longest simulated slice per update, so fast speeds skip nothing
  const SPEEDS = [1, 2, 4, 8];
  const SPEED_KEY = "kw:sim-speed";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const styles = getComputedStyle(document.documentElement);
  const rgb = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  const TEXT = rgb("--c-text-rgb", "236, 230, 218");
  const ACCENT = rgb("--c-accent-rgb", "255, 138, 31");
  const VICTIM = rgb("--label-cyan-rgb", "57, 197, 207");
  const BLUE = rgb("--label-blue-rgb", "88, 166, 255");
  const INK = "#0b0a09";

  // ===== MAZE =====
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const cellX = cell => cell % N;
  const cellY = cell => Math.floor(cell / N);

  function neighbour(cell, dir) {
    const x = cellX(cell) + DIRS[dir][0];
    const y = cellY(cell) + DIRS[dir][1];
    return x >= 0 && x < N && y >= 0 && y < N ? y * N + x : -1;
  }

  function generate(seed) {
    const rand = mulberry32(seed);
    const walls = Array.from({ length: N * N }, () => [true, true, true, true]);
    const open = (cell, dir) => {
      walls[cell][dir] = false;
      walls[neighbour(cell, dir)][OPPOSITE[dir]] = false;
    };

    // Recursive backtracker (iterative), giving a perfect maze.
    const seen = new Array(N * N).fill(false);
    const stack = [START];
    seen[START] = true;
    while (stack.length) {
      const cell = stack[stack.length - 1];
      const options = [0, 1, 2, 3].filter(dir => {
        const next = neighbour(cell, dir);
        return next >= 0 && !seen[next];
      });
      if (!options.length) {
        stack.pop();
        continue;
      }
      const dir = options[Math.floor(rand() * options.length)];
      const next = neighbour(cell, dir);
      open(cell, dir);
      seen[next] = true;
      stack.push(next);
    }

    // Knock out some interior walls so there are loops to reason about.
    const interior = [];
    for (let cell = 0; cell < N * N; cell++) {
      for (const dir of [1, 2]) {
        if (neighbour(cell, dir) >= 0 && walls[cell][dir]) interior.push([cell, dir]);
      }
    }
    for (let i = 0; i < Math.round(interior.length * EXTRA_OPENINGS); i++) {
      const pick = i + Math.floor(rand() * (interior.length - i));
      [interior[i], interior[pick]] = [interior[pick], interior[i]];
      open(interior[i][0], interior[i][1]);
    }

    // Floor tiles. A black tile is only kept if every other tile is still
    // reachable from the start, so a run can always be completed.
    const tiles = new Array(N * N).fill(null);
    const blackCount = () => tiles.filter(tile => tile === "black").length;
    const allReachable = () => {
      const seen = new Set([START]);
      const queue = [START];
      while (queue.length) {
        const cell = queue.shift();
        for (let dir = 0; dir < 4; dir++) {
          const next = neighbour(cell, dir);
          if (walls[cell][dir] || next < 0 || seen.has(next) || tiles[next] === "black") continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return seen.size === N * N - blackCount();
    };

    const order = Array.from({ length: N * N }, (_, cell) => cell);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const cell of order) {
      if (blackCount() >= BLACK_TILES) break;
      if (cell === START) continue;
      tiles[cell] = "black";
      if (!allReachable()) tiles[cell] = null;
    }
    let blue = 0;
    for (const cell of order.slice().reverse()) {
      if (blue >= BLUE_TILES) break;
      if (cell === START || tiles[cell]) continue;
      tiles[cell] = "blue";
      blue++;
    }

    // Victims sit on a wall of a random cell, never the start or a hole.
    const victims = [];
    const count = 3 + Math.floor(rand() * 2);
    const used = new Set([START]);
    while (victims.length < count) {
      const cell = Math.floor(rand() * N * N);
      if (used.has(cell) || tiles[cell] === "black") continue;
      const sides = [0, 1, 2, 3].filter(dir => walls[cell][dir]);
      if (!sides.length) continue;
      used.add(cell);
      victims.push({ cell, dir: sides[Math.floor(rand() * sides.length)], foundAt: null });
    }

    return { walls, victims, tiles };
  }

  // ===== ROBOT =====
  let sim = null;

  function newRun(runNumber) {
    const seed = Math.floor(Math.random() * 0x10000);
    const maze = generate(seed);
    sim = {
      seed,
      run: runNumber,
      maze,
      known: Array.from({ length: N * N }, () => [null, null, null, null]),
      visited: new Set(),
      pos: START,
      heading: 0,
      angle: 0,
      step: null,
      route: null,
      phase: "EXPLORING",
      clock: 0,
      runTime: 0,
      senseAt: -Infinity,
      trail: [],
      black: new Set(),
      waitUntil: 0,
      hold: 0
    };
    arrive(START);
    if (out.seed) out.seed.textContent = `0x${seed.toString(16).toUpperCase().padStart(4, "0")}`;
    if (out.run) out.run.textContent = String(runNumber);
  }

  function sense(cell) {
    const { known, maze } = sim;
    for (let dir = 0; dir < 4; dir++) {
      const wall = maze.walls[cell][dir];
      known[cell][dir] = wall;
      const next = neighbour(cell, dir);
      if (next >= 0) known[next][OPPOSITE[dir]] = wall;
    }
    for (const victim of maze.victims) {
      if (victim.cell === cell && victim.foundAt === null) victim.foundAt = sim.clock;
    }
    sim.senseAt = sim.clock;
  }

  function arrive(cell) {
    sim.pos = cell;
    sim.trail.push({ cell, t: sim.clock });
    if (!sim.visited.has(cell)) {
      sim.visited.add(cell);
      sense(cell);
    }
    if (sim.maze.tiles[cell] === "blue") sim.waitUntil = sim.clock + BLUE_WAIT_MS;
  }

  // Breadth-first search over edges the robot knows are open.
  function route(from, isGoal) {
    const previous = new Map([[from, -1]]);
    const queue = [from];
    while (queue.length) {
      const cell = queue.shift();
      if (cell !== from && isGoal(cell)) {
        const path = [];
        for (let at = cell; at !== from; at = previous.get(at)) path.unshift(at);
        return path;
      }
      for (let dir = 0; dir < 4; dir++) {
        if (sim.known[cell][dir] !== false) continue;
        const next = neighbour(cell, dir);
        if (next >= 0 && !previous.has(next) && !sim.black.has(next)) {
          previous.set(next, cell);
          queue.push(next);
        }
      }
    }
    return null;
  }

  function nextCell() {
    if (sim.phase === "EXPLORING") {
      const path = route(sim.pos, cell => !sim.visited.has(cell));
      if (path) return path[0];
      sim.phase = "RETURNING";
      sim.route = sim.pos === START ? [] : route(sim.pos, cell => cell === START) || [];
    }
    if (sim.phase === "RETURNING") {
      if (sim.route.length) return sim.route.shift();
      sim.phase = "COMPLETE";
      sim.hold = 0;
    }
    return -1;
  }

  function directionTo(from, to) {
    const dx = cellX(to) - cellX(from);
    const dy = cellY(to) - cellY(from);
    return DIRS.findIndex(([x, y]) => x === dx && y === dy);
  }

  // dt is simulated time (scaled by the speed control); realDt is wall time,
  // so the finished-run hold and fade last as long at any speed.
  function update(dt, realDt = dt) {
    if (sim.phase === "COMPLETE" || sim.phase === "FADE") {
      sim.hold += realDt;
      if (sim.phase === "COMPLETE" && sim.hold > HOLD_MS) {
        sim.phase = "FADE";
        sim.hold = 0;
      } else if (sim.phase === "FADE" && sim.hold > FADE_MS) {
        newRun(sim.run + 1);
      }
      return;
    }

    sim.clock += dt;
    sim.runTime += dt;

    // Parked on a blue tile.
    if (sim.clock < sim.waitUntil) return;

    if (!sim.step) {
      const to = nextCell();
      if (to < 0) return;
      const dir = directionTo(sim.pos, to);
      const turn = dir !== sim.heading ? TURN_MS : 0;
      let delta = dir - sim.heading;
      if (delta > 2) delta -= 4;
      if (delta < -2) delta += 4;
      // Heading onto a black tile turns into a probe: in, trip, back out.
      const probe = sim.maze.tiles[to] === "black";
      sim.step = {
        from: sim.pos,
        to,
        dir,
        probe,
        tripped: false,
        fromAngle: sim.angle,
        toAngle: sim.angle + delta * (Math.PI / 2),
        start: sim.clock,
        turn,
        duration: turn + (probe ? STEP_MS * 1.6 : STEP_MS)
      };
    }

    const step = sim.step;
    const elapsed = sim.clock - step.start;
    if (step.probe && !step.tripped && elapsed >= step.turn + (step.duration - step.turn) / 2) {
      step.tripped = true;
      sim.black.add(step.to);
    }
    if (elapsed >= step.duration) {
      sim.heading = step.dir;
      sim.angle = step.toAngle;
      sim.step = null;
      if (!step.probe) arrive(step.to);
    }
  }

  // Robot pose (in cell units) for rendering, interpolated mid-step.
  function pose() {
    const step = sim.step;
    if (!step) return { x: cellX(sim.pos), y: cellY(sim.pos), angle: sim.angle };
    const elapsed = sim.clock - step.start;
    const turnT = step.turn ? Math.min(1, elapsed / step.turn) : 1;
    const moveT = Math.max(0, Math.min(1, (elapsed - step.turn) / (step.duration - step.turn)));
    const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const m = step.probe
      ? PROBE_DEPTH * ease(moveT < 0.5 ? moveT * 2 : (1 - moveT) * 2)
      : ease(moveT);
    return {
      x: cellX(step.from) + (cellX(step.to) - cellX(step.from)) * m,
      y: cellY(step.from) + (cellY(step.to) - cellY(step.from)) * m,
      angle: step.fromAngle + (step.toAngle - step.fromAngle) * ease(turnT)
    };
  }

  // ===== RENDER =====
  let size = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    if (!size) return;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sim) render();
  }

  function render() {
    if (!size) return;
    const margin = size * 0.07;
    const unit = (size - margin * 2) / N;
    const px = x => margin + x * unit;
    const center = cell => [px(cellX(cell) + 0.5), px(cellY(cell) + 0.5)];

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    if (sim.phase === "FADE") ctx.globalAlpha = Math.max(0, 1 - sim.hold / FADE_MS);

    // Lattice points: the unknown maze, before anything is sensed.
    ctx.fillStyle = `rgba(${TEXT}, 0.16)`;
    for (let y = 0; y <= N; y++) {
      for (let x = 0; x <= N; x++) ctx.fillRect(px(x) - 1, px(y) - 1, 2, 2);
    }

    // Visited tiles.
    ctx.fillStyle = `rgba(${ACCENT}, 0.07)`;
    for (const cell of sim.visited) {
      ctx.fillRect(px(cellX(cell)) + 1, px(cellY(cell)) + 1, unit - 2, unit - 2);
    }

    // Floor tiles the robot has found: blue where it has driven on, black
    // (hatched) where its floor sensor tripped.
    ctx.fillStyle = `rgba(${BLUE}, 0.3)`;
    for (const cell of sim.visited) {
      if (sim.maze.tiles[cell] === "blue") {
        ctx.fillRect(px(cellX(cell)) + 1, px(cellY(cell)) + 1, unit - 2, unit - 2);
      }
    }
    for (const cell of sim.black) {
      const x = px(cellX(cell)) + 1;
      const y = px(cellY(cell)) + 1;
      const w = unit - 2;
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, w);
      ctx.clip();
      ctx.strokeStyle = `rgba(${TEXT}, 0.16)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let offset = -w; offset < w; offset += w / 4) {
        ctx.moveTo(x + offset, y + w);
        ctx.lineTo(x + offset + w, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Start tile marker.
    ctx.strokeStyle = `rgba(${TEXT}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(px(cellX(START)) + unit * 0.18, px(cellY(START)) + unit * 0.18, unit * 0.64, unit * 0.64);
    ctx.setLineDash([]);

    // Trail through visited cell centres, fading with age.
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let i = 1; i < sim.trail.length; i++) {
      const age = reduceMotion ? 0 : sim.clock - sim.trail[i].t;
      const alpha = Math.max(0.12, 1 - age / TRAIL_FADE_MS) * 0.55;
      const [x1, y1] = center(sim.trail[i - 1].cell);
      const [x2, y2] = center(sim.trail[i].cell);
      ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Known walls: north and west of every cell, plus the outer east/south.
    ctx.strokeStyle = `rgba(${TEXT}, 0.9)`;
    ctx.lineWidth = 2;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (let cell = 0; cell < N * N; cell++) {
      const x = cellX(cell);
      const y = cellY(cell);
      const known = sim.known[cell];
      if (known[0] === true) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x + 1), px(y)); }
      if (known[3] === true) { ctx.moveTo(px(x), px(y)); ctx.lineTo(px(x), px(y + 1)); }
      if (x === N - 1 && known[1] === true) { ctx.moveTo(px(x + 1), px(y)); ctx.lineTo(px(x + 1), px(y + 1)); }
      if (y === N - 1 && known[2] === true) { ctx.moveTo(px(x), px(y + 1)); ctx.lineTo(px(x + 1), px(y + 1)); }
    }
    ctx.stroke();

    // Victims, once found: a ring against the wall they were spotted on.
    for (const victim of sim.maze.victims) {
      if (victim.foundAt === null) continue;
      const [cx, cy] = center(victim.cell);
      const vx = cx + DIRS[victim.dir][0] * unit * 0.3;
      const vy = cy + DIRS[victim.dir][1] * unit * 0.3;
      ctx.strokeStyle = `rgba(${VICTIM}, 0.95)`;
      ctx.fillStyle = `rgba(${VICTIM}, 0.25)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vx, vy, unit * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const since = sim.clock - victim.foundAt;
      if (!reduceMotion && since < 900) {
        const t = since / 900;
        ctx.strokeStyle = `rgba(${VICTIM}, ${0.8 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(vx, vy, unit * (0.12 + t * 0.35), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Robot.
    const { x, y, angle } = pose();
    const rx = px(x + 0.5);
    const ry = px(y + 0.5);

    // Sensor ping on arrival: short rays toward all four walls.
    const sinceSense = sim.clock - sim.senseAt;
    if (!reduceMotion && sinceSense < SENSE_MS && !sim.step) {
      const t = sinceSense / SENSE_MS;
      ctx.strokeStyle = `rgba(${ACCENT}, ${0.7 * (1 - t)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [dx, dy] of DIRS) {
        ctx.moveTo(rx + dx * unit * 0.2, ry + dy * unit * 0.2);
        ctx.lineTo(rx + dx * unit * (0.2 + 0.28 * t), ry + dy * unit * (0.2 + 0.28 * t));
      }
      ctx.stroke();
    }

    const body = unit * 0.44;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(angle);
    ctx.fillStyle = `rgb(${ACCENT})`;
    ctx.fillRect(-body / 2, -body / 2, body, body);
    ctx.fillStyle = INK;
    ctx.fillRect(-body * 0.18, -body / 2, body * 0.36, body * 0.2);
    ctx.restore();

    ctx.restore();
    updateReadouts();
  }

  function formatTime(ms) {
    const tenths = Math.floor(ms / 100);
    const minutes = Math.floor(tenths / 600);
    const seconds = Math.floor((tenths % 600) / 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
  }

  function updateReadouts() {
    const found = sim.maze.victims.filter(victim => victim.foundAt !== null).length;
    let state = sim.phase === "FADE" ? "COMPLETE" : sim.phase;
    if (sim.step && sim.step.probe && sim.step.tripped) state = "BLACK TILE";
    else if (state !== "COMPLETE" && sim.clock < sim.waitUntil) state = "BLUE STOP";
    if (out.mapped) out.mapped.textContent = `${sim.visited.size + sim.black.size}/${N * N}`;
    if (out.victims) out.victims.textContent = `${found}/${sim.maze.victims.length}`;
    if (out.time) out.time.textContent = formatTime(sim.runTime);
    if (out.state && out.state.textContent !== state) {
      out.state.textContent = state;
      out.state.dataset.state = state;
    }

    // A finished run gets the rainbow treatment on every readout.
    const done = state === "COMPLETE";
    for (const element of [out.mapped, out.victims, out.time, out.state]) {
      if (element) element.classList.toggle("rainbow-text", done);
    }
  }

  // ===== LOOP =====
  let visible = true;
  let rafId = null;
  let last = null;

  let speed = 1;

  function frame(now) {
    rafId = null;
    const real = last === null ? 16 : Math.min(50, now - last);
    last = now;
    // Advance in small slices so a fast speed never jumps over a cell.
    let remaining = real * speed;
    while (remaining > 0) {
      const slice = Math.min(MAX_TICK, remaining);
      update(slice, slice / speed);
      remaining -= slice;
    }
    render();
    schedule();
  }

  // ===== SPEED CONTROL =====
  const speedGroup = document.getElementById("sim-speed");
  const speedButtons = speedGroup ? Array.from(speedGroup.querySelectorAll("[data-speed]")) : [];

  function setSpeed(value, save) {
    speed = SPEEDS.includes(value) ? value : 1;
    speedButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
    });
    if (!save) return;
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch (_) {
      // Remembering the speed is a convenience; the control works without it.
    }
  }

  speedButtons.forEach(button => {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed), true));
  });

  try {
    setSpeed(Number(localStorage.getItem(SPEED_KEY)) || 1, false);
  } catch (_) {
    setSpeed(1, false);
  }

  function schedule() {
    if (rafId === null && visible && !document.hidden) rafId = requestAnimationFrame(frame);
  }

  function pause() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    last = null;
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  newRun(1);
  resize();

  if (reduceMotion) {
    // No animation: run one exploration to completion and show the result.
    if (speedGroup) speedGroup.hidden = true;
    let guard = 0;
    while (sim.phase !== "COMPLETE" && guard++ < 100000) update(STEP_MS / 4);
    render();
    return;
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) schedule();
      else pause();
    }).observe(canvas);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else schedule();
  });

  schedule();
})();
