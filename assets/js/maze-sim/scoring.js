// Scoring constants and victim rules. Pure, DOM-free.
export const POINTS = { VICTIM_ID: 5, KIT: 10, RAMP: 10, EXIT_BONUS_PER_VICTIM: 10 };

// Rescue kits to drop per victim: harmed / red 2, stable / yellow 1, unharmed / green 0.
export function kitsRequired(type) {
  switch (type) {
    case "H":
    case "red":
      return 2;
    case "S":
    case "yellow":
      return 1;
    default:
      return 0;
  }
}

// Points so far: identifications, dropped kits, ramp crossings, and the exit
// bonus once the run is finished (FADE is the tail of COMPLETE).
export function score(sim) {
  const identified = sim.identified.size;
  const kits = sim.kits.reduce((total, n) => total + n, 0);
  const finished = sim.phase === "COMPLETE" || sim.phase === "FADE";
  return (
    POINTS.VICTIM_ID * identified +
    POINTS.KIT * kits +
    POINTS.RAMP * (sim.rampTraversals ?? 0) +
    (finished ? POINTS.EXIT_BONUS_PER_VICTIM * identified : 0)
  );
}
