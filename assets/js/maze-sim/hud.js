// Readouts under the canvas: seed, run, mapped tiles, victims, score, time, gyro heading,
// front ToF distance, state.
import { stateLabel, formatHeading, frontMm } from "./robot.js?v=10";
import { score } from "./scoring.js?v=10";

function formatTime(ms) {
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

export function createHud() {
  const out = {
    seed: document.getElementById("sim-seed"),
    run: document.getElementById("sim-run"),
    mapped: document.getElementById("sim-mapped"),
    victims: document.getElementById("sim-victims"),
    score: document.getElementById("sim-score"),
    time: document.getElementById("sim-time"),
    hdg: document.getElementById("sim-hdg"),
    front: document.getElementById("sim-front"),
    state: document.getElementById("sim-state")
  };

  function update(sim) {
    // Both levels count: cells out of 130, victims out of all of them.
    const { levels } = sim.field;
    const cells = levels.reduce((n, level) => n + level.size * level.size, 0);
    const victims = levels.reduce((n, level) => n + level.victims.length, 0);
    const state = stateLabel(sim);
    if (out.seed) out.seed.textContent = `0x${sim.seed.toString(16).toUpperCase().padStart(4, "0")}`;
    if (out.run) out.run.textContent = String(sim.run);
    if (out.mapped) out.mapped.textContent = `${sim.visited.size + sim.black.size}/${cells}`;
    if (out.victims) out.victims.textContent = `${sim.found.size}/${victims}`;
    if (out.score) out.score.textContent = String(score(sim));
    if (out.time) out.time.textContent = formatTime(sim.runTime);
    if (out.hdg) out.hdg.textContent = formatHeading(sim.gyro);
    if (out.front) out.front.textContent = `${frontMm(sim)} mm`;
    if (out.state && out.state.textContent !== state) {
      out.state.textContent = state;
      out.state.dataset.state = state;
    }

    // A finished run gets the rainbow treatment on every readout.
    const done = state === "COMPLETE";
    for (const element of [out.mapped, out.victims, out.score, out.time, out.hdg, out.front, out.state]) {
      if (element) element.classList.toggle("rainbow-text", done);
    }
  }

  return { update };
}
