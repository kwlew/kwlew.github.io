// Builds assets/data/github-stats.json: lines added and deleted across the
// public, non-fork repos of USER, plus a language breakdown by bytes.
// Run daily by .github/workflows/github-stats.yml; also runnable locally with
//   GITHUB_TOKEN=$(gh auth token) node scripts/github-stats.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER = "kwlew";
const OUT = "assets/data/github-stats.json";

// Repos left out of the totals because vendored or committed-then-deleted
// dependencies would swamp "lines added":
//   kmoney-bots, Drone-game: dependency folders committed and later removed
//   CraftCPP: GLFW, glad and glm vendored under libs/
const EXCLUDE = new Set(["kmoney-bots", "Drone-game", "CraftCPP"]);

const API = "https://api.github.com";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is not set");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${USER}-site-stats`
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(path) {
  const response = await fetch(`${API}${path}`, { headers });
  if (response.status === 202 || response.status === 204) return { status: response.status, data: null };
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return { status: response.status, data: await response.json() };
}

// code_frequency answers 202 while GitHub computes it in the background, so
// poll with a growing delay before giving up on this run.
async function codeFrequency(repo) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { status, data } = await get(`/repos/${USER}/${repo}/stats/code_frequency`);
    if (status === 204) return { added: 0, deleted: 0 };
    if (status !== 202) {
      const weeks = Array.isArray(data) ? data : [];
      return {
        added: weeks.reduce((sum, week) => sum + week[1], 0),
        deleted: weeks.reduce((sum, week) => sum - week[2], 0)
      };
    }
    await sleep(2000 * attempt);
  }
  return null;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch (_) {
    return null;
  }
}

const withoutTimestamp = stats => JSON.stringify({ ...stats, generatedAt: undefined });

async function main() {
  const previous = await readPrevious();
  const previousRepos = new Map((previous?.repos || []).map(repo => [repo.name, repo]));

  const { data: allRepos } = await get(`/users/${USER}/repos?per_page=100&type=owner`);
  const repos = allRepos.filter(repo => !repo.fork && !EXCLUDE.has(repo.name));

  const rows = [];
  const languages = new Map();

  for (const repo of repos) {
    let lines = await codeFrequency(repo.name);
    if (!lines) {
      // Still computing after every retry: keep yesterday's figure rather
      // than letting the total dip because of GitHub lag.
      const kept = previousRepos.get(repo.name);
      console.warn(`warn: ${repo.name} stats not ready, ${kept ? "keeping previous" : "skipping"}`);
      if (!kept) continue;
      lines = { added: kept.added, deleted: kept.deleted };
    }
    rows.push({ name: repo.name, ...lines });

    const { data: repoLanguages } = await get(`/repos/${USER}/${repo.name}/languages`);
    for (const [name, bytes] of Object.entries(repoLanguages || {})) {
      languages.set(name, (languages.get(name) || 0) + bytes);
    }
  }

  rows.sort((a, b) => b.added - a.added);

  const stats = {
    generatedAt: new Date().toISOString(),
    user: USER,
    repoCount: rows.length,
    linesAdded: rows.reduce((sum, row) => sum + row.added, 0),
    linesDeleted: rows.reduce((sum, row) => sum + row.deleted, 0),
    repos: rows,
    languages: [...languages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes)
  };

  console.table(rows);
  console.log(`total: ${stats.linesAdded} added, ${stats.linesDeleted} deleted across ${stats.repoCount} repos`);

  if (previous && withoutTimestamp(previous) === withoutTimestamp(stats)) {
    console.log("unchanged, not writing");
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(stats, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
