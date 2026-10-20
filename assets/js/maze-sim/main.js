// Rescue Maze simulation for the landing hero: loop, speed control, pausing.
//
// Each run generates a fresh thin-wall maze from a seed, then a robot that
// knows nothing about it explores cell by cell. With no frontier left it
// drives back to the start, holds, and a new maze begins.
//
// The 2D canvas always works. Where WebGL is available a lazily loaded 3D view
// takes over, with a 3D/2D toggle; any failure leaves the sim on 2D.
import { generateField } from "./maze.js?v=10";
import { createSim, step, STEP_MS, FADE_MS } from "./robot.js?v=10";
import { createRenderer } from "./render2d.js?v=10";
import { createHud } from "./hud.js?v=10";

const canvas = document.getElementById("sim-canvas");
const renderer = canvas ? createRenderer(canvas) : null;

const VIEW_KEY = "kw:sim-view";
const PERF_WINDOW_MS = 3000;   // judge the 3D frame rate over this much visible time
const PERF_MAX_MS = 25;        // average frame interval above this means 2D
const PERF_CAP_MS = 250;       // one long stall (tab switch, GC) counts as at most this

if (renderer) {
  const hud = createHud();

  const SPEEDS = [1, 2, 4, 8];
  const SPEED_KEY = "kw:sim-speed";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let sim = null;

  function newRun(runNumber) {
    const seed = Math.floor(Math.random() * 0x10000);
    sim = createSim(generateField(seed));
    sim.run = runNumber;
  }

  // The renderer the loop draws with: the 2D one, or the 3D one while it is up.
  let active = renderer;
  let renderer3d = null;
  let perf = null;

  function draw() {
    active.render(sim);
    hud.update(sim);
  }

  // ===== LOOP =====
  let visible = true;
  let rafId = null;
  let last = null;

  let speed = 1;

  function frame(now) {
    rafId = null;
    const real = last === null ? 16 : Math.min(50, now - last);
    if (perf !== null && last !== null) judgePerf(Math.min(now - last, PERF_CAP_MS));
    last = now;
    // step() advances in small slices so a fast speed never jumps over a cell.
    step(sim, real * speed, real);
    if (sim.phase === "FADE" && sim.hold > FADE_MS) newRun(sim.run + 1);
    draw();
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

  // The stage wraps both canvases and keeps the 2D canvas's size, so it is what
  // gets observed: the hidden view can never take the sizing or visibility with it.
  const stage = document.getElementById("sim-stage") || canvas;

  if ("ResizeObserver" in window) {
    new ResizeObserver(() => active.resize()).observe(stage);
  } else {
    window.addEventListener("resize", () => active.resize(), { passive: true });
  }

  // ===== 3D VIEW =====
  const figure = canvas.closest("figure");
  const viewGroup = document.getElementById("sim-view");
  const viewButtons = viewGroup ? Array.from(viewGroup.querySelectorAll("[data-view]")) : [];
  let canvas3d = document.getElementById("sim-canvas-3d");
  let view = "2d";         // the view the viewer is meant to be on, 3D once it is up
  let modulePromise = null;
  let attempt = 0;         // bumps on every switch; a stale async switch cleans up after itself
  let warned = false;

  function storedView() {
    try {
      return localStorage.getItem(VIEW_KEY) === "2d" ? "2d" : "3d";
    } catch (_) {
      return "3d";
    }
  }

  function storeView(value) {
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch (_) {
      // Remembering the view is a convenience; the toggle works without it.
    }
  }

  function webglAvailable() {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) return false;
      // Do not hold a context just to have asked.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch (_) {
      return false;
    }
  }

  function showPressed(value) {
    view = value;
    viewButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.view === value));
    });
  }

  // 3D could not be had: stay on (or go back to) 2D and take the toggle away.
  function giveUp3d(reason) {
    if (!warned) {
      warned = true;
      console.warn("Maze sim: 3D view unavailable, using 2D.", reason);
    }
    attempt++;
    showPressed("2d");
    if (viewGroup) viewGroup.hidden = true;
    use2d();
  }

  function use2d() {
    if (renderer3d) {
      renderer3d.dispose();
      renderer3d = null;
    }
    perf = null;
    if (canvas3d) canvas3d.hidden = true;
    if (stage !== canvas) stage.dataset.view = "2d";
    active = renderer;
    renderer.resize();
    if (sim) draw();
  }

  // A canvas that has had its WebGL context released cannot get another one, so
  // every 3D start gets a new element in the old one's place.
  function freshCanvas3d() {
    const next = canvas3d.cloneNode(false);
    next.hidden = true;
    canvas3d.replaceWith(next);
    canvas3d = next;
    return next;
  }

  function loadRender3d() {
    if (!modulePromise) modulePromise = import("./render3d.js?v=10");
    return modulePromise;
  }

  async function use3d(automatic) {
    const mine = ++attempt;
    let lost = false;
    let created = null;
    try {
      const module = await loadRender3d();
      if (mine !== attempt) return;
      const target = freshCanvas3d();
      created = await module.createRenderer3d(target, {
        onLost: () => {
          lost = true;
          // Context lost (GPU reset, backgrounded phone): carry on in 2D, in memory only.
          if (renderer3d === created) {
            attempt++;
            showPressed("2d");
            use2d();
          }
        }
      });
      if (mine !== attempt || lost) {
        created.dispose();
        if (lost && mine === attempt) {
          attempt++;
          showPressed("2d");
          use2d();
        }
        return;
      }
      renderer3d = created;
      active = created;
      target.hidden = false;
      viewGroup.hidden = false;
      if (stage !== canvas) stage.dataset.view = "3d";
      created.resize();
      created.render(sim);
      last = null;
      perf = automatic ? { sum: 0, frames: 0 } : null;
    } catch (error) {
      if (created) created.dispose();
      if (mine === attempt) giveUp3d(error);
    }
  }

  // Slow machines: if the first seconds of automatic 3D average over the limit,
  // go to 2D for this visit. The stored choice is left alone.
  function judgePerf(interval) {
    perf.sum += interval;
    perf.frames++;
    if (perf.sum < PERF_WINDOW_MS) return;
    const average = perf.sum / perf.frames;
    perf = null;
    if (average > PERF_MAX_MS) {
      attempt++;
      showPressed("2d");
      use2d();
    }
  }

  viewButtons.forEach(button => {
    button.addEventListener("click", () => {
      const next = button.dataset.view === "2d" ? "2d" : "3d";
      if (next === view) return;
      showPressed(next);
      storeView(next);
      if (next === "2d") {
        attempt++;
        use2d();
      } else {
        use3d(false);
      }
    });
  });

  // Runs once, when the sim first scrolls into view: the 3D code is only
  // fetched for people who actually see it.
  let viewsStarted = false;
  function startViews() {
    if (viewsStarted) return;
    viewsStarted = true;
    if (reduceMotion || !canvas3d || !viewGroup || (figure && figure.dataset.view === "2d")) return;
    if (!webglAvailable()) {
      giveUp3d(new Error("WebGL is not available"));
      return;
    }
    if (storedView() === "3d") {
      showPressed("3d");
      use3d(true);
    } else {
      showPressed("2d");
      viewGroup.hidden = false;
    }
  }

  newRun(1);
  renderer.resize();

  if (reduceMotion) {
    // No animation: run one exploration to completion and draw it once. The
    // robot ends back on the start tile, so the frame shows level 1 with both
    // level tabs at their final counts; no beams, no wobble.
    if (speedGroup) speedGroup.hidden = true;
    let guard = 0;
    while (sim.phase !== "COMPLETE" && guard++ < 100000) step(sim, STEP_MS / 4);
    draw();
  } else {
    draw();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible) {
          startViews();
          schedule();
        } else {
          pause();
        }
      }).observe(stage);
    } else {
      startViews();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
      else schedule();
    });

    schedule();
  }
}
