// Live project readouts for the sub-pages (plugins, Starsown).
// A container names its sources with data-repo="owner/name" and, optionally,
// data-modrinth="slug"; each [data-stat] inside it is filled from them:
//   stars      GitHub stargazers
//   release    latest GitHub release tag, linked to the release page
//   pushed     time since the last push
//   downloads  Modrinth downloads
// Every source fails on its own and leaves a quiet "n/a" behind.
(function () {
  "use strict";

  const numberFormat = new Intl.NumberFormat("en-US");

  function ago(iso) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 60) return `${days}d ago`;
    return `${Math.round(days / 30)}mo ago`;
  }

  async function getJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function fill(root, field, text, href) {
    root.querySelectorAll(`[data-stat="${field}"]`).forEach(element => {
      element.textContent = text;
      element.closest("[data-stat-row]")?.setAttribute("data-state", href === null ? "error" : "live");
      if (href && element.tagName === "A") element.href = href;
    });
  }

  function load(root) {
    const repo = root.dataset.repo;
    const slug = root.dataset.modrinth;

    if (repo) {
      getJSON(`https://api.github.com/repos/${repo}`)
        .then(data => {
          fill(root, "stars", numberFormat.format(data.stargazers_count));
          fill(root, "pushed", ago(data.pushed_at));
        })
        .catch(() => {
          fill(root, "stars", "n/a", null);
          fill(root, "pushed", "n/a", null);
        });

      getJSON(`https://api.github.com/repos/${repo}/releases/latest`)
        .then(data => fill(root, "release", data.tag_name || "none", data.html_url))
        .catch(() => fill(root, "release", "none yet", null));
    }

    if (slug) {
      getJSON(`https://api.modrinth.com/v2/project/${slug}`)
        .then(data => fill(root, "downloads", numberFormat.format(data.downloads)))
        .catch(() => fill(root, "downloads", "n/a", null));
    }
  }

  document.querySelectorAll("[data-repo], [data-modrinth]").forEach(load);
})();
