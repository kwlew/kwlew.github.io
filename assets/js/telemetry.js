// Landing page instruments: live data channels, odometer readouts, the
// contribution heatmap, the API console, the record timeline and a few small
// page behaviours (clock, scroll progress, reveal, copy button).
//
// Values reach the page through data-bind="path" attributes; each source
// calls setValue(path, value) and setState(channel, state). Elements with
// data-channel or data-watch follow a channel's loading/live/error state.
(function () {
  "use strict";

  const API_BASE = "https://api.kwlew.dev";
  const STARSOWN_POLL = 12000;
  const CONTRIB_URL = "https://github-contributions-api.jogruber.de/v4/kwlew?y=last";
  const EVENTS_URL = "https://api.github.com/users/kwlew/events/public?per_page=100";
  const CODEFORCES_URL = "https://codeforces.com/api/user.info?handles=kwlew";
  const GITHUB_STATS_URL = "/assets/data/github-stats.json";
  const LEETCODE_STATS_URL = "/assets/data/leetcode-stats.json";
  const HOUR = 60 * 60 * 1000;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const numberFormat = new Intl.NumberFormat("en-US");
  const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

  // ===== FETCH HELPERS =====
  async function fetchJSON(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const started = performance.now();

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      const ms = Math.round(performance.now() - started);
      if (!response.ok) {
        const error = new Error(`${url} returned ${response.status}`);
        error.status = response.status;
        error.ms = ms;
        throw error;
      }
      return { data: await response.json(), ms, status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  function readCache(key, ttl) {
    try {
      const cached = JSON.parse(localStorage.getItem(key));
      if (cached && Date.now() - cached.savedAt < ttl) return cached;
    } catch (_) {
      // Storage can be disabled; live fetching still works without it.
    }
    return null;
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
    } catch (_) {
      // A full or disabled localStorage should not break a channel.
    }
  }

  // Serve from localStorage while fresh; otherwise fetch, validate, cache.
  async function cachedJSON(url, key, ttl, validate = () => true) {
    const hit = readCache(key, ttl);
    if (hit) return hit;

    const { data } = await fetchJSON(url);
    if (!validate(data)) throw new TypeError(`Unexpected response from ${url}`);
    writeCache(key, data);
    return { data, savedAt: Date.now() };
  }

  // ===== VISIBILITY =====
  const visibleCallbacks = new WeakMap();
  const visibilityObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const callbacks = visibleCallbacks.get(entry.target) || [];
          visibleCallbacks.delete(entry.target);
          visibilityObserver.unobserve(entry.target);
          callbacks.forEach(fn => fn());
        }
      }, { threshold: 0.15 })
    : null;

  // Run fn once the element first scrolls into view.
  function onVisible(element, fn) {
    if (!visibilityObserver) {
      fn();
      return;
    }
    const callbacks = visibleCallbacks.get(element);
    if (callbacks) {
      callbacks.push(fn);
    } else {
      visibleCallbacks.set(element, [fn]);
      visibilityObserver.observe(element);
    }
  }

  // ===== BINDINGS =====
  const bound = new Map();
  document.querySelectorAll("[data-bind]").forEach(element => {
    const path = element.dataset.bind;
    if (!bound.has(path)) bound.set(path, []);
    bound.get(path).push(element);
  });

  function setValue(path, value) {
    for (const element of bound.get(path) || []) {
      if (typeof value === "number" && element.hasAttribute("data-odo")) {
        odometer(element, value);
      } else {
        element.textContent = typeof value === "number" ? numberFormat.format(value) : value;
      }
    }
  }

  function blink(led) {
    if (!led || reduceMotion) return;
    led.classList.remove("blink");
    void led.offsetWidth;
    led.classList.add("blink");
  }

  function setState(channel, state, savedAt) {
    document.querySelectorAll(`[data-channel="${channel}"], [data-watch="${channel}"]`).forEach(element => {
      element.dataset.state = state;
      const age = element.querySelector("[data-age]");

      if (state === "live") {
        blink(element.querySelector(".led"));
        if (age) age.dataset.ts = String(savedAt || Date.now());
      } else if (state === "error" && age) {
        delete age.dataset.ts;
        age.textContent = "no signal";
      }
    });
    tickAges();
  }

  // ===== AGES =====
  function formatAge(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function tickAges() {
    const now = Date.now();
    document.querySelectorAll("[data-age][data-ts]").forEach(element => {
      element.textContent = `updated ${formatAge(now - Number(element.dataset.ts))}`;
    });
    document.querySelectorAll("[data-rel][data-ts]").forEach(element => {
      element.textContent = formatAge(now - Number(element.dataset.ts));
    });
  }

  // ===== ODOMETER =====
  // Each digit is a column of 0-9 slid into place, so a changing value rolls
  // rather than flickers. Digits stay at 0 until the readout is first seen,
  // which doubles as the count-up on arrival.
  function buildOdometer(element, text) {
    const layout = text.replace(/\d/g, "0");
    let odo = element.querySelector(".odo");
    if (odo && odo.dataset.layout === layout) return odo;

    odo = document.createElement("span");
    odo.className = "odo";
    odo.dataset.layout = layout;
    odo.setAttribute("aria-hidden", "true");

    for (const char of text) {
      if (/\d/.test(char)) {
        const digit = document.createElement("span");
        const column = document.createElement("span");
        digit.className = "odo-d";
        column.className = "odo-col";
        for (let n = 0; n <= 9; n++) {
          const cell = document.createElement("span");
          cell.textContent = String(n);
          column.append(cell);
        }
        digit.append(column);
        odo.append(digit);
      } else {
        const separator = document.createElement("span");
        separator.className = "odo-sep";
        separator.textContent = char;
        odo.append(separator);
      }
    }

    const label = document.createElement("span");
    label.className = "visually-hidden";
    element.replaceChildren(label, odo);
    void odo.offsetWidth;
    return odo;
  }

  function applyDigits(element, text) {
    const odo = buildOdometer(element, text);
    const digits = text.replace(/\D/g, "");
    odo.querySelectorAll(".odo-col").forEach((column, index) => {
      column.style.transform = `translateY(${-Number(digits[index])}em)`;
    });
    element.querySelector(".visually-hidden").textContent = text;
  }

  function odometer(element, value) {
    const text = numberFormat.format(value);
    if (reduceMotion) {
      element.textContent = text;
      return;
    }

    if (element.dataset.seen) {
      applyDigits(element, text);
      return;
    }

    buildOdometer(element, text);
    element.querySelector(".visually-hidden").textContent = text;
    element.dataset.pending = text;
    if (!element.dataset.waiting) {
      element.dataset.waiting = "1";
      onVisible(element, () => {
        element.dataset.seen = "1";
        applyDigits(element, element.dataset.pending);
      });
    }
  }

  // Plain count-up for the static hero figures.
  function countUp(element, target, duration = 1100) {
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(2, -10 * t);
      element.textContent = numberFormat.format(Math.round(target * (t === 1 ? 1 : eased)));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function initCountUps() {
    if (reduceMotion) return;
    document.querySelectorAll("[data-count]").forEach(element => {
      const target = Number(element.textContent);
      if (!Number.isFinite(target)) return;
      element.textContent = "0";
      onVisible(element, () => countUp(element, target));
    });
  }

  // ===== PAGE CHROME =====
  function initClock() {
    const clock = document.getElementById("clock");
    if (!clock) return;
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Fortaleza",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const tick = () => { clock.textContent = format.format(new Date()); };
    tick();
    setInterval(tick, 1000);
  }

  function initScrollProgress() {
    const bar = document.getElementById("scroll-progress");
    if (!bar) return;
    let queued = false;
    function update() {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty("--progress", max > 0 ? String(Math.min(1, window.scrollY / max)) : "0");
    }
    const queue = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    update();
  }

  function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      items.forEach(element => element.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });
    items.forEach(element => observer.observe(element));
  }

  function initCopy() {
    const button = document.getElementById("copy-email");
    const status = document.getElementById("copy-status");
    if (!button) return;
    let timer = null;

    function done(message) {
      button.textContent = message;
      button.classList.add("done");
      if (status) status.textContent = message === "Copied" ? "Email address copied" : "Email address selected";
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("done");
      }, 1500);
    }

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        done("Copied");
      } catch (_) {
        // No clipboard access (older browser or insecure context): select
        // the address so a manual copy is one keystroke away.
        const email = document.querySelector(".email");
        const range = document.createRange();
        range.selectNodeContents(email);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        done("Selected");
      }
    });
  }

  // ===== STARSOWN =====
  const sparkSamples = [];
  const SPARK_MAX = 60;
  let starsownTimer = null;

  function drawSparkline() {
    const svg = document.getElementById("so-spark");
    const count = document.getElementById("so-samples");
    if (count) count.textContent = `${sparkSamples.length} sample${sparkSamples.length === 1 ? "" : "s"}`;
    if (!svg) return;

    const max = Math.max(1, ...sparkSamples);
    const step = sparkSamples.length > 1 ? 100 / (sparkSamples.length - 1) : 0;
    const points = sparkSamples.map((value, index) => [
      sparkSamples.length > 1 ? index * step : 100,
      38 - (value / max) * 34
    ]);
    if (points.length === 1) points.unshift([0, points[0][1]]);

    const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    svg.querySelector(".spark-line").setAttribute("d", line);
    svg.querySelector(".spark-area").setAttribute("d", `${line} L100 40 L0 40 Z`);
  }

  function renderStarsown(data) {
    const online = Number(data.online) || 0;
    const stars = Number(data.stars) || 0;
    const golden = Number(data.golden) || 0;
    const rainbow = Number(data.rainbow) || 0;

    setValue("starsown.online", online);
    setValue("starsown.stars", stars);
    setValue("starsown.golden", golden);
    setValue("starsown.rainbow", rainbow);
    setValue("starsown.goldenRarity", golden ? `1 golden for every ${Math.round(stars / golden)} stars` : "No golden stars yet");
    setValue("starsown.rainbowRarity", rainbow ? `1 rainbow for every ${Math.round(stars / rainbow)} stars` : "No rainbow stars yet");

    const idle = document.getElementById("so-idle");
    if (idle) {
      idle.textContent = online
        ? `${online === 1 ? "1 player" : `${numberFormat.format(online)} players`} in game right now`
        : "world idle, nobody playing right now";
    }

    sparkSamples.push(online);
    if (sparkSamples.length > SPARK_MAX) sparkSamples.shift();
    drawSparkline();
  }

  async function loadStarsown() {
    try {
      const response = await fetchJSON(`${API_BASE}/stats`);
      renderStarsown(response.data);
      setState("starsown", "live");
      apiConsole.feed("/stats", response);
    } catch (_) {
      setState("starsown", "error");
    }
  }

  async function loadStarsownVersion() {
    try {
      const { data } = await fetchJSON(`${API_BASE}/version`);
      setValue("starsown.version", String(data.version || "?"));
    } catch (_) {
      setValue("starsown.version", "?");
    }
  }

  function scheduleStarsown() {
    clearInterval(starsownTimer);
    starsownTimer = setInterval(loadStarsown, STARSOWN_POLL);
  }

  // ===== GITHUB =====
  function streaks(days) {
    let longest = 0;
    let run = 0;
    for (const day of days) {
      run = day.count > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }

    // Today with no contributions yet does not break the current streak.
    let index = days.length - 1;
    if (index >= 0 && days[index].count === 0) index--;
    let current = 0;
    while (index >= 0 && days[index].count > 0) {
      current++;
      index--;
    }
    return { longest, current };
  }

  function renderHeatmap(days, total) {
    const heatmap = document.getElementById("heatmap");
    const months = document.getElementById("hm-months");
    const wrap = document.getElementById("heatmap-wrap");
    if (!heatmap || !months) return;

    const first = new Date(`${days[0].date}T00:00:00Z`);
    const pad = first.getUTCDay();
    const cells = document.createDocumentFragment();
    const labels = document.createDocumentFragment();

    for (let i = 0; i < pad; i++) {
      const blank = document.createElement("i");
      blank.className = "hm";
      blank.style.visibility = "hidden";
      cells.append(blank);
    }

    let lastLabelColumn = -3;
    days.forEach((day, index) => {
      const date = new Date(`${day.date}T00:00:00Z`);
      const column = Math.floor((pad + index) / 7);
      const cell = document.createElement("i");
      cell.className = "hm";
      cell.dataset.l = String(day.level);
      cell.style.setProperty("--c", String(column));
      cell.title = `${day.count} contribution${day.count === 1 ? "" : "s"} on ${dayFormat.format(date)}`;
      cells.append(cell);

      // Label a column with its month when the month starts in it, keeping
      // labels at least three columns apart so they never overlap.
      if (date.getUTCDate() === 1 && column - lastLabelColumn >= 3) {
        const label = document.createElement("span");
        label.textContent = monthFormat.format(date);
        label.style.gridColumn = String(column + 1);
        labels.append(label);
        lastLabelColumn = column;
      }
    });

    heatmap.replaceChildren(cells);
    months.replaceChildren(labels);
    if (wrap) wrap.setAttribute("aria-label", `Contribution heatmap: ${numberFormat.format(total)} contributions in the past year`);
    // On narrow screens the well scrolls; start at the most recent weeks.
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    if (!reduceMotion) onVisible(heatmap, () => heatmap.classList.add("cascade"));
  }

  async function loadContributions() {
    try {
      const { data, savedAt } = await cachedJSON(CONTRIB_URL, "kw:contributions", 6 * HOUR,
        body => body && Array.isArray(body.contributions) && body.contributions.length > 0);
      const days = data.contributions.slice().sort((a, b) => a.date.localeCompare(b.date));
      const total = Number(data.total && data.total.lastYear) || days.reduce((sum, day) => sum + day.count, 0);
      const { longest, current } = streaks(days);

      setValue("github.total", total);
      setValue("github.activeDays", days.filter(day => day.count > 0).length);
      setValue("github.days", days.length);
      setValue("github.longest", longest);
      setValue("github.current", current);
      renderHeatmap(days, total);
      setState("github", "live", savedAt);
    } catch (_) {
      setState("github", "error");
    }
  }

  async function loadEvents() {
    const feed = document.getElementById("gh-feed");
    try {
      const { data } = await cachedJSON(EVENTS_URL, "kw:events", 10 * 60 * 1000, Array.isArray);
      const latest = new Map();
      for (const event of data) {
        if (event.type !== "PushEvent") continue;
        const repo = event.repo.name.split("/")[1];
        if (!latest.has(repo)) latest.set(repo, event);
      }

      const haven = latest.get("Haven");
      for (const element of bound.get("github.push.Haven") || []) {
        if (haven) {
          element.dataset.rel = "";
          element.dataset.ts = String(Date.parse(haven.created_at));
        } else {
          element.textContent = "not recently";
        }
      }

      if (feed) {
        const rows = [...latest.values()].slice(0, 5).map(event => {
          const item = document.createElement("li");
          const link = document.createElement("a");
          const head = String(event.payload.head || "");
          link.href = head
            ? `https://github.com/${event.repo.name}/commit/${head}`
            : `https://github.com/${event.repo.name}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";

          const parts = [
            ["repo", event.repo.name.split("/")[1]],
            ["branch", String(event.payload.ref || "").replace("refs/heads/", "")],
            ["sha", head.slice(0, 7)],
            ["age", ""]
          ];
          for (const [name, text] of parts) {
            const span = document.createElement("span");
            span.className = name;
            span.textContent = text;
            if (name === "age") {
              span.dataset.rel = "";
              span.dataset.ts = String(Date.parse(event.created_at));
            }
            link.append(span);
          }
          item.append(link);
          return item;
        });
        if (rows.length) {
          feed.replaceChildren(...rows);
        } else {
          feed.replaceChildren(feedMessage("No public pushes in the last 90 days."));
        }
      }
      tickAges();
    } catch (_) {
      if (feed) feed.replaceChildren(feedMessage("Push feed is unavailable right now."));
      setValue("github.push.Haven", "unknown");
    }
  }

  function feedMessage(text) {
    const item = document.createElement("li");
    item.className = "readout-note";
    item.textContent = text;
    return item;
  }

  function loadGithub() {
    loadContributions();
    loadEvents();
  }

  // ===== LINES OF CODE + LANGUAGES (daily JSON from the stats workflow) =====
  const LANGUAGE_COLORS = {
    Java: "--label-orange",
    Lua: "--label-blue",
    JavaScript: "--label-gold",
    "C++": "--label-pink",
    HTML: "--label-red",
    CSS: "--label-purple",
    Python: "--label-cyan",
    "C#": "--label-green",
    C: "--label-silver"
  };

  function renderLanguages(languages) {
    const section = document.getElementById("languages");
    const bar = document.getElementById("langbar");
    const legend = document.getElementById("lang-legend");
    const totalLabel = document.getElementById("lang-total");
    if (!section || !bar || !legend || !languages.length) return;

    const total = languages.reduce((sum, language) => sum + language.bytes, 0);
    const top = languages.slice(0, 6);
    const rest = languages.slice(6).reduce((sum, language) => sum + language.bytes, 0);
    if (rest > 0) top.push({ name: "Other", bytes: rest });

    const percent = bytes => `${((bytes / total) * 100).toFixed(1)}%`;
    const colour = name => `var(${LANGUAGE_COLORS[name] || "--label-gray"})`;

    bar.replaceChildren(...top.map((language, index) => {
      const segment = document.createElement("span");
      segment.style.setProperty("--w", String(language.bytes));
      segment.style.setProperty("--lc", colour(language.name));
      segment.style.setProperty("--k", String(index));
      segment.title = `${language.name} ${percent(language.bytes)}`;
      return segment;
    }));
    bar.setAttribute("aria-label", top.map(language => `${language.name} ${percent(language.bytes)}`).join(", "));

    legend.replaceChildren(...top.map(language => {
      const item = document.createElement("li");
      const swatch = document.createElement("i");
      const share = document.createElement("b");
      swatch.style.setProperty("--lc", colour(language.name));
      share.textContent = percent(language.bytes);
      item.append(swatch, language.name, share);
      return item;
    }));

    if (totalLabel) totalLabel.textContent = `${(total / 1e6).toFixed(2)} MB of source`;
    section.hidden = false;
    if (!reduceMotion) onVisible(bar, () => bar.classList.add("cascade"));
  }

  async function loadGithubStats() {
    try {
      const { data } = await fetchJSON(GITHUB_STATS_URL);
      setValue("loc.added", Number(data.linesAdded) || 0);
      setValue("loc.repos", Number(data.repoCount) || 0);

      const list = document.getElementById("loc-repos");
      if (list && Array.isArray(data.repos)) {
        list.replaceChildren(...data.repos.filter(repo => repo.added > 0).map(repo => {
          const item = document.createElement("li");
          const count = document.createElement("b");
          count.textContent = numberFormat.format(repo.added);
          item.append(repo.name, count);
          return item;
        }));
      }

      renderLanguages(Array.isArray(data.languages) ? data.languages : []);

      const stamp = document.getElementById("stats-date");
      if (stamp && data.generatedAt) {
        stamp.textContent = `Stats updated ${dayFormat.format(new Date(data.generatedAt))}`;
      }
    } catch (_) {
      setValue("loc.added", "--");
    }
  }

  // ===== CODEFORCES =====
  async function loadCodeforces() {
    try {
      const { data, savedAt } = await cachedJSON(CODEFORCES_URL, "kw:codeforces", 6 * HOUR,
        body => body && body.status === "OK" && Array.isArray(body.result) && body.result.length > 0);
      const user = data.result[0];
      setValue("cf.rating", Number(user.rating) || 0);
      setValue("cf.maxRating", Number(user.maxRating) || 0);
      setValue("cf.rank", user.rank || "unrated");
      setState("codeforces", "live", savedAt);
    } catch (_) {
      setState("codeforces", "error");
    }
  }

  // ===== LEETCODE (snapshot from the leetcode-stats workflow) =====
  // LeetCode's GraphQL API sends no CORS headers, so the workflow queries it
  // every 6 hours and the page reads the committed JSON.
  const DIFFICULTIES = ["easy", "medium", "hard"];

  function renderLeetcodeBar(solved) {
    const bar = document.getElementById("lc-bar");
    if (!bar) return;
    const parts = DIFFICULTIES.filter(level => solved[level] > 0);
    bar.replaceChildren(...parts.map((level, index) => {
      const segment = document.createElement("span");
      segment.className = level;
      segment.style.setProperty("--w", String(solved[level]));
      segment.style.setProperty("--k", String(index));
      return segment;
    }));
    bar.setAttribute("aria-label", DIFFICULTIES.map(level => `${solved[level] || 0} ${level}`).join(", "));
    if (!reduceMotion) onVisible(bar, () => bar.classList.add("cascade"));
  }

  function renderLeetcodeFeed(recent) {
    const feed = document.getElementById("lc-feed");
    if (!feed) return;
    if (!recent.length) {
      feed.replaceChildren(feedMessage("No accepted submissions yet."));
      return;
    }
    feed.replaceChildren(...recent.slice(0, 6).map(problem => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `https://leetcode.com/problems/${encodeURIComponent(problem.slug)}/`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = problem.title;

      const level = String(problem.difficulty || "").toLowerCase();
      const difficulty = document.createElement("span");
      difficulty.className = `diff ${DIFFICULTIES.includes(level) ? level : ""}`;
      difficulty.textContent = level || "?";

      const age = document.createElement("span");
      age.className = "age";
      age.dataset.rel = "";
      age.dataset.ts = String(Date.parse(problem.solvedAt));

      link.append(title, difficulty, age);
      item.append(link);
      return item;
    }));
    tickAges();
  }

  async function loadLeetcode() {
    try {
      const { data } = await fetchJSON(LEETCODE_STATS_URL);
      const solved = data.solved || {};
      const total = data.total || {};
      if (typeof solved.all !== "number") throw new TypeError("Unexpected LeetCode snapshot");

      setValue("lc.solved", solved.all);
      setValue("lc.total", Number(total.all) || 0);
      for (const level of DIFFICULTIES) {
        const name = level[0].toUpperCase() + level.slice(1);
        setValue(`lc.${level}`, Number(solved[level]) || 0);
        setValue(`lc.total${name}`, Number(total[level]) || 0);
      }
      setValue("lc.languages", (data.languages || []).slice(0, 3)
        .map(language => `${language.name} ${language.solved}`).join(", ") || "--");

      const contest = document.getElementById("lc-contest");
      if (contest && data.contest) {
        setValue("lc.rating", Number(data.contest.rating) || 0);
        const top = Number(data.contest.topPercentage);
        setValue("lc.top", Number.isFinite(top) && top > 0 ? `${top.toFixed(1)}%` : "--");
        contest.hidden = false;
      }

      renderLeetcodeBar(solved);
      renderLeetcodeFeed(Array.isArray(data.recent) ? data.recent : []);
      setState("leetcode", "live", Date.parse(data.generatedAt) || Date.now());
    } catch (_) {
      setState("leetcode", "error");
    }
  }

  // ===== MODRINTH (rendered by modrinth-stats.js, mirrored here) =====
  window.addEventListener("kw:modrinth", event => {
    if (!event.detail) {
      setState("modrinth", "error");
      return;
    }
    const { projects, totalDownloads, savedAt } = event.detail;
    const kmoney = projects.find(project => project.slug === "kmoney");
    setValue("modrinth.total", totalDownloads);
    setValue("modrinth.kmoney", kmoney ? Number(kmoney.downloads) || 0 : "--");
    renderMilestone(totalDownloads);
    setState("modrinth", "live", savedAt);
  });

  // Next round-number download target: 100, 250, 500, 1k, 2.5k, 5k, 10k...
  function milestoneAfter(total) {
    for (let scale = 100; ; scale *= 10) {
      for (const step of [1, 2.5, 5]) {
        if (scale * step > total) return scale * step;
      }
    }
  }

  function milestoneBefore(next) {
    const steps = [];
    for (let scale = 100; scale <= next; scale *= 10) {
      for (const step of [1, 2.5, 5]) steps.push(scale * step);
    }
    const lower = steps.filter(value => value < next);
    return lower.length ? lower[lower.length - 1] : 0;
  }

  function renderMilestone(total) {
    const block = document.getElementById("mr-milestone");
    const bar = document.getElementById("mr-milestone-bar");
    if (!block || !bar) return;

    const next = milestoneAfter(total);
    const previous = milestoneBefore(next);
    const progress = Math.max(0, Math.min(1, (total - previous) / (next - previous)));

    setValue("modrinth.nextMilestone", next);
    setValue("modrinth.prevMilestone", previous);
    setValue("modrinth.toGo", next - total);
    bar.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    block.hidden = false;

    const fill = bar.querySelector("span");
    if (reduceMotion) {
      fill.style.setProperty("--p", String(progress));
    } else {
      onVisible(bar, () => fill.style.setProperty("--p", String(progress)));
    }
  }

  // ===== API CONSOLE =====
  const apiConsole = (function () {
    const tabs = Array.from(document.querySelectorAll(".api-tab"));
    const url = document.getElementById("api-url");
    const request = document.getElementById("api-req");
    const status = document.getElementById("api-status");
    const body = document.getElementById("api-body");
    const endpoints = document.getElementById("api-endpoints");
    if (!tabs.length || !url || !status || !body) return { feed() {}, retry() {} };

    let current = "/stats";
    let activated = false;
    let requestId = 0;
    const previous = new Map();

    function flatten(value, prefix = "", out = new Map()) {
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) flatten(child, `${prefix}.${key}`, out);
      } else {
        out.set(prefix, value);
      }
      return out;
    }

    // Pretty-print JSON as DOM nodes (never innerHTML from the response),
    // flashing any value that changed since the previous response.
    function renderJSON(data, endpoint) {
      const before = previous.get(endpoint);
      const after = flatten(data);
      previous.set(endpoint, after);
      const fragment = document.createDocumentFragment();
      const text = value => fragment.append(document.createTextNode(value));

      function span(className, value, path) {
        const element = document.createElement("span");
        element.className = className;
        element.textContent = value;
        if (before && before.has(path) && before.get(path) !== after.get(path) && !reduceMotion) {
          element.classList.add("j-flash");
        }
        fragment.append(element);
      }

      function walk(value, indent, path) {
        if (value && typeof value === "object") {
          const isArray = Array.isArray(value);
          const entries = Object.entries(value);
          text(isArray ? "[" : "{");
          entries.forEach(([key, child], index) => {
            text(`\n${"  ".repeat(indent + 1)}`);
            if (!isArray) {
              span("j-key", JSON.stringify(key), null);
              text(": ");
            }
            walk(child, indent + 1, `${path}.${key}`);
            if (index < entries.length - 1) text(",");
          });
          text(`${entries.length ? `\n${"  ".repeat(indent)}` : ""}${isArray ? "]" : "}"}`);
        } else if (typeof value === "string") {
          span("j-str", JSON.stringify(value), path);
        } else {
          span("j-num", String(value), path);
        }
      }

      walk(data, 0, "");
      body.replaceChildren(fragment);
    }

    function showStatus(ok, code, ms) {
      const badge = document.createElement("span");
      badge.className = ok ? "ok" : "bad";
      badge.textContent = ok ? `${code} OK` : String(code || "ERR");
      const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
      status.replaceChildren(badge, document.createTextNode(ms != null ? ` · ${ms} ms · ${time}` : ` · ${time}`));
    }

    function typeUrl(target) {
      return new Promise(resolve => {
        if (reduceMotion) {
          url.textContent = target;
          resolve();
          return;
        }
        request.classList.add("typing");
        const start = performance.now();
        const duration = 320;
        function step(now) {
          const t = Math.min(1, (now - start) / duration);
          url.textContent = target.slice(0, Math.max(1, Math.round(target.length * t)));
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            request.classList.remove("typing");
            resolve();
          }
        }
        requestAnimationFrame(step);
      });
    }

    async function send(endpoint) {
      activated = true;
      current = endpoint;
      const id = ++requestId;
      body.classList.add("pending");
      status.textContent = "sending…";
      await typeUrl(`${API_BASE}${endpoint}`);

      try {
        const response = await fetchJSON(`${API_BASE}${endpoint}`);
        if (id !== requestId) return;
        renderJSON(response.data, endpoint);
        showStatus(true, response.status, response.ms);
        setState("api", "live");
      } catch (error) {
        if (id !== requestId) return;
        showStatus(false, error.status, error.ms);
        body.textContent = "Request failed. The API may be unreachable from this network.";
        setState("api", "error");
      } finally {
        if (id === requestId) body.classList.remove("pending");
      }
    }

    function select(tab, focus) {
      tabs.forEach(other => {
        const on = other === tab;
        other.setAttribute("aria-selected", String(on));
        other.tabIndex = on ? 0 : -1;
      });
      body.setAttribute("aria-labelledby", tab.id);
      if (focus) tab.focus();
      send(tab.dataset.endpoint);
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", event => {
        const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        select(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
      });
    });

    // The root endpoint documents itself; list its read-only routes, leaving
    // out the heartbeat ones (POST, or anything taking a player id).
    async function loadEndpoints() {
      if (!endpoints) return;
      try {
        const { data } = await fetchJSON(`${API_BASE}/`);
        const rows = Object.entries(data.endpoints || {})
          .filter(([route]) => route.startsWith("GET ") && !route.includes("id="));
        endpoints.replaceChildren(...rows.flatMap(([route, description]) => {
          const term = document.createElement("dt");
          const detail = document.createElement("dd");
          term.textContent = route;
          detail.textContent = description;
          return [term, detail];
        }));
      } catch (_) {
        endpoints.remove();
      }
    }

    const panel = document.getElementById("live-api");
    if (panel) {
      onVisible(panel, () => {
        if (!activated) send(current);
        loadEndpoints();
      });
    }

    return {
      // Reuse the Starsown poll's /stats response instead of a second request.
      feed(endpoint, response) {
        if (!activated || endpoint !== current || body.classList.contains("pending")) return;
        renderJSON(response.data, endpoint);
        showStatus(true, response.status, response.ms);
        setState("api", "live");
      },
      retry() {
        send(current);
      }
    };
  })();

  // ===== RECORD =====
  const BADGE_ORDER = ["world", "national", "gold", "silver", "bronze", "phase", "lost", "participant"];

  function expandYears(value) {
    return String(value)
      .split(",")
      .map(part => Number(part.trim()))
      .filter(year => Number.isFinite(year) && year > 0)
      .map(year => (year < 100 ? 2000 + year : year));
  }

  function initRecord() {
    const record = window.KW_RECORD;
    if (!record) return;
    const { ACHIEVEMENTS, PANELS } = record;
    const summaries = PANELS.personal.summaries.flat();

    // Tally and hero medal figure come straight from the record's summaries.
    const tally = document.getElementById("tally");
    if (tally) {
      tally.replaceChildren(...summaries.map(summary => {
        const item = document.createElement("li");
        const count = document.createElement("b");
        const label = document.createElement("span");
        item.className = summary.kind;
        count.textContent = String(summary.count).padStart(2, "0");
        label.textContent = summary.label;
        item.append(count, label);
        return item;
      }));
    }

    const medals = summaries.filter(summary => ["gold", "silver", "bronze"].includes(summary.kind));
    const medalTotal = document.getElementById("medal-total");
    const medalSplit = document.getElementById("medal-split");
    if (medalTotal) medalTotal.textContent = String(medals.reduce((sum, summary) => sum + Number(summary.count), 0));
    if (medalSplit) medalSplit.textContent = medals.map(summary => `${summary.count} ${summary.label.toLowerCase()}`).join(", ");

    // Timeline: one square per dated result on the personal record.
    // Upcoming events are not results yet, so they are left out.
    const entries = [];
    let undated = 0;
    for (const id of PANELS.personal.cards) {
      const achievement = ACHIEVEMENTS[id];
      let groupYear = null;
      for (const result of achievement.results) {
        if (result.group) {
          groupYear = Number(result.group);
          continue;
        }
        if (/^upcoming$/i.test(result.text)) continue;

        const years = result.year ? expandYears(result.year) : (groupYear ? [groupYear] : []);
        if (!years.length) {
          undated++;
          continue;
        }
        const text = result.text.replace(/^\d+×\s*/, "");
        const what = result.label ? `${achievement.acronym} ${result.label}` : achievement.acronym;
        for (const year of years) {
          entries.push({ year, badge: result.badge, label: `${what}, ${year}: ${text}` });
        }
      }
    }
    renderTimeline(entries, undated);
  }

  function renderTimeline(entries, undated) {
    const timeline = document.getElementById("timeline");
    const columns = document.getElementById("tl-cols");
    const years = document.getElementById("tl-years");
    const readout = document.getElementById("tl-readout");
    const total = document.getElementById("tl-total");
    if (!timeline || !columns || !years || !entries.length) return;

    const first = Math.min(...entries.map(entry => entry.year));
    const last = Math.max(...entries.map(entry => entry.year));
    const span = last - first + 1;
    const template = `repeat(${span}, minmax(0, 1fr))`;
    columns.style.gridTemplateColumns = template;
    years.style.gridTemplateColumns = template;

    const defaultText = readout ? readout.textContent : "";
    const show = text => { if (readout) readout.textContent = text; };
    let k = 0;

    const columnNodes = [];
    const yearNodes = [];
    for (let year = first; year <= last; year++) {
      const results = entries
        .filter(entry => entry.year === year)
        .sort((a, b) => BADGE_ORDER.indexOf(a.badge) - BADGE_ORDER.indexOf(b.badge));

      const column = document.createElement("div");
      const count = document.createElement("span");
      const stack = document.createElement("div");
      column.className = "tl-col";
      column.tabIndex = 0;
      column.setAttribute("aria-label", `${year}: ${results.length} result${results.length === 1 ? "" : "s"}. ${results.map(entry => entry.label).join("; ")}`);
      count.className = "tl-count";
      count.textContent = String(results.length);
      stack.className = "tl-stack";

      for (const entry of results) {
        const square = document.createElement("span");
        square.className = `tl-sq ${entry.badge}`;
        square.style.setProperty("--k", String(k++));
        square.addEventListener("mouseenter", () => show(entry.label));
        stack.append(square);
      }

      column.addEventListener("focus", () => show(`${year}: ${results.map(entry => entry.label.replace(/, \d{4}:/, ":")).join(" / ")}`));
      column.addEventListener("mouseleave", () => show(defaultText));
      column.addEventListener("blur", () => show(defaultText));
      column.append(count, stack);
      columnNodes.push(column);

      const label = document.createElement("span");
      label.textContent = String(year);
      yearNodes.push(label);
    }

    columns.replaceChildren(...columnNodes);
    years.replaceChildren(...yearNodes);
    if (total) total.textContent = `${entries.length} results${undated ? `, ${undated} undated not shown` : ""}`;
    if (!reduceMotion) onVisible(timeline, () => timeline.classList.add("is-in"));
  }

  // Days until CBR 2026, counted on the Fortaleza calendar.
  function initCountdown() {
    const element = document.getElementById("cbr-countdown");
    if (!element) return;
    const start = Date.UTC(2026, 10, 25);
    const end = Date.UTC(2026, 10, 29);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const now = Date.UTC(y, m - 1, d);
    const days = Math.round((start - now) / 86400000);

    if (now > end) {
      element.textContent = "results soon";
    } else if (now >= start) {
      element.textContent = "underway";
    } else if (days === 1) {
      element.textContent = "tomorrow";
    } else if (days <= 7) {
      element.textContent = "this week";
    } else {
      element.textContent = `in ${days} days`;
    }
  }

  // ===== RETRY =====
  const retries = {
    starsown: loadStarsown,
    github: loadGithub,
    codeforces: loadCodeforces,
    leetcode: loadLeetcode,
    api: () => apiConsole.retry()
  };

  document.querySelectorAll("[data-retry]").forEach(button => {
    button.addEventListener("click", () => {
      const channel = button.dataset.retry;
      if (!retries[channel]) return;
      setState(channel, "loading");
      retries[channel]();
    });
  });

  // ===== INIT =====
  initRecord();
  initCountUps();
  initClock();
  initScrollProgress();
  initReveal();
  initCopy();
  initCountdown();

  loadStarsown();
  loadStarsownVersion();
  scheduleStarsown();
  loadGithub();
  loadGithubStats();
  loadCodeforces();
  loadLeetcode();

  // Pause polling in background tabs and refresh immediately on return.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(starsownTimer);
    } else {
      loadStarsown();
      scheduleStarsown();
    }
  });

  setInterval(tickAges, 1000);
})();
