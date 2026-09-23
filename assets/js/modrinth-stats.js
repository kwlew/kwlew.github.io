(function () {
  "use strict";

  const USERNAME = "kwlew";
  const API_URL = `https://api.modrinth.com/v2/user/${USERNAME}/projects`;
  const CACHE_KEY = `modrinth-projects:${USERNAME}`;
  const CACHE_TTL = 15 * 60 * 1000;
  const numberFormat = new Intl.NumberFormat();

  const downloadsElement = document.getElementById("modrinth-downloads");
  const projectCountElement = document.getElementById("modrinth-project-count");
  const projectsElement = document.getElementById("modrinth-projects");
  const statusElement = document.getElementById("modrinth-status");

  // The downloads total is optional: the landing page shows it through
  // telemetry.js (odometer), which listens for the kw:modrinth event below.
  if (!projectCountElement || !projectsElement || !statusElement) return;

  function announce(detail) {
    window.dispatchEvent(new CustomEvent("kw:modrinth", { detail }));
  }

  function projectKind(project) {
    const loaders = Array.isArray(project.loaders) ? project.loaders : [];
    if (loaders.some(loader => ["bukkit", "paper", "spigot", "purpur", "folia"].includes(loader))) {
      return "Plugin";
    }

    const labels = {
      mod: "Mod",
      modpack: "Modpack",
      resourcepack: "Resource pack",
      shader: "Shader",
      datapack: "Data pack"
    };
    return labels[project.project_type] || "Project";
  }

  function createProjectRow(project, index) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    const rank = document.createElement("span");
    const icon = document.createElement("span");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("small");
    const downloads = document.createElement("span");
    const downloadsLabel = document.createElement("small");
    const arrow = document.createElement("span");

    item.className = "modrinth-project";
    link.href = `https://modrinth.com/project/${encodeURIComponent(project.slug || project.id)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${project.title}, ${numberFormat.format(project.downloads || 0)} downloads on Modrinth`);

    rank.className = "modrinth-rank";
    rank.textContent = String(index + 1).padStart(2, "0");

    icon.className = "modrinth-project-icon";
    const iconFallback = document.createElement("span");
    iconFallback.textContent = (project.title || "M").charAt(0).toUpperCase();
    icon.append(iconFallback);
    if (project.icon_url) {
      const image = document.createElement("img");
      image.src = project.icon_url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("load", () => { iconFallback.remove(); });
      image.addEventListener("error", () => { image.remove(); });
      icon.append(image);
    }

    copy.className = "modrinth-project-copy";
    title.textContent = project.title || "Untitled project";
    meta.textContent = projectKind(project);
    copy.append(title, meta);

    downloads.className = "modrinth-project-downloads";
    downloads.textContent = numberFormat.format(project.downloads || 0);
    downloadsLabel.textContent = "downloads";
    downloads.append(downloadsLabel);

    arrow.className = "modrinth-project-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "\u2197";

    link.append(rank, icon, copy, downloads, arrow);
    item.append(link);
    return item;
  }

  function render(projects, savedAt) {
    const cached = savedAt !== null;
    const sortedProjects = [...projects].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    const totalDownloads = projects.reduce((total, project) => total + (Number(project.downloads) || 0), 0);

    if (downloadsElement) downloadsElement.textContent = numberFormat.format(totalDownloads);
    projectCountElement.textContent = numberFormat.format(projects.length);
    projectsElement.replaceChildren(...sortedProjects.slice(0, 3).map(createProjectRow));
    projectsElement.setAttribute("aria-busy", "false");

    if (!projects.length) {
      const empty = document.createElement("li");
      empty.className = "modrinth-error";
      empty.textContent = "No public projects found.";
      projectsElement.append(empty);
    }

    statusElement.textContent = cached ? "Recently updated \u00b7 cached for 15 min" : "Updated just now \u00b7 public API";
    announce({ projects, totalDownloads, savedAt: savedAt || Date.now() });
  }

  function renderError() {
    projectsElement.setAttribute("aria-busy", "false");
    projectsElement.replaceChildren();

    const error = document.createElement("li");
    const message = document.createElement("span");
    const retry = document.createElement("button");
    error.className = "modrinth-error";
    message.textContent = "Modrinth stats are temporarily unavailable.";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadProjects, { once: true });
    error.append(message, retry);
    projectsElement.append(error);

    statusElement.textContent = "Could not reach the Modrinth API";
    announce(null);
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && Array.isArray(cached.projects) && Date.now() - cached.savedAt < CACHE_TTL) {
        return cached;
      }
    } catch (_) {
      // Storage can be disabled; live fetching still works without it.
    }
    return null;
  }

  function writeCache(projects) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ projects, savedAt: Date.now() }));
    } catch (_) {
      // A full or disabled localStorage should not break the widget.
    }
  }

  async function loadProjects() {
    const cached = readCache();
    if (cached) {
      render(cached.projects, cached.savedAt);
      return;
    }

    statusElement.textContent = "Loading current stats\u2026";
    projectsElement.setAttribute("aria-busy", "true");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(API_URL, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Modrinth returned ${response.status}`);

      const projects = await response.json();
      if (!Array.isArray(projects)) throw new TypeError("Unexpected Modrinth response");

      writeCache(projects);
      render(projects, null);
    } catch (_) {
      renderError();
    } finally {
      clearTimeout(timeout);
    }
  }

  loadProjects();
})();
