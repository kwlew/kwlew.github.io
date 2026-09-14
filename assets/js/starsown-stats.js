(function () {
  "use strict";

  const API_URL = "https://api.kwlew.dev/stats";
  const POLL_INTERVAL = 12000;
  const numberFormat = new Intl.NumberFormat();

  const grid = document.getElementById("starsown-stats-grid");
  const statusText = document.getElementById("starsown-stats-status-text");
  const onlineElement = document.getElementById("starsown-stat-online");
  const starsElement = document.getElementById("starsown-stat-stars");
  const goldenElement = document.getElementById("starsown-stat-golden");
  const rainbowElement = document.getElementById("starsown-stat-rainbow");

  if (!grid || !statusText || !onlineElement || !starsElement || !goldenElement || !rainbowElement) return;

  let pollTimer = null;

  function removeError() {
    const error = grid.parentElement.querySelector(".starsown-stats-error");
    if (error) error.remove();
  }

  function render(data) {
    onlineElement.textContent = numberFormat.format(Number(data.online) || 0);
    starsElement.textContent = numberFormat.format(Number(data.stars) || 0);
    goldenElement.textContent = numberFormat.format(Number(data.golden) || 0);
    rainbowElement.textContent = numberFormat.format(Number(data.rainbow) || 0);

    grid.setAttribute("aria-busy", "false");
    removeError();
    statusText.textContent = "Live · updated just now";
  }

  function renderError() {
    grid.setAttribute("aria-busy", "false");
    statusText.textContent = "Could not reach the stats API";

    if (grid.parentElement.querySelector(".starsown-stats-error")) return;

    const error = document.createElement("div");
    const message = document.createElement("span");
    const retry = document.createElement("button");

    error.className = "starsown-stats-error";
    message.textContent = "Live stats are temporarily unavailable.";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => load(), { once: true });

    error.append(message, retry);
    grid.insertAdjacentElement("afterend", error);
  }

  async function load() {
    grid.setAttribute("aria-busy", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(API_URL, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Stats API returned ${response.status}`);

      const data = await response.json();
      render(data);
    } catch (_) {
      renderError();
    } finally {
      clearTimeout(timeout);
    }
  }

  function schedule() {
    clearInterval(pollTimer);
    pollTimer = setInterval(load, POLL_INTERVAL);
  }

  // Pause polling in background tabs and refresh immediately on return, so
  // the numbers never sit stale for whoever left the tab open.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(pollTimer);
    } else {
      load();
      schedule();
    }
  });

  load();
  schedule();
})();
