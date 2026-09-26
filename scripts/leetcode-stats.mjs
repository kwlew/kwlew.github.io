// Builds assets/data/leetcode-stats.json: solved counts by difficulty, recent
// accepted problems, languages and contest rating for USER on LeetCode.
// LeetCode's GraphQL endpoint sends no CORS headers, so the landing page
// cannot call it from the browser; this snapshot stands in for it.
// Run every 6 hours by .github/workflows/leetcode-stats.yml; also runnable
// locally with
//   node scripts/leetcode-stats.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER = "kwlew";
const OUT = "assets/data/leetcode-stats.json";
const ENDPOINT = "https://leetcode.com/graphql";
const RECENT = 8;

// Users without a ranking are reported at this placeholder value.
const UNRANKED = 5000000;

async function query(text, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `https://leetcode.com/u/${USER}/`,
      "User-Agent": `${USER}-site-stats`
    },
    body: JSON.stringify({ query: text, variables })
  });
  if (!response.ok) throw new Error(`${ENDPOINT} returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map(error => error.message).join("; "));
  return body.data;
}

const PROFILE = `
  query ($user: String!) {
    allQuestionsCount { difficulty count }
    matchedUser(username: $user) {
      profile { ranking }
      submitStatsGlobal { acSubmissionNum { difficulty count } }
      userCalendar { streak totalActiveDays }
      languageProblemCount { languageName problemsSolved }
    }
    userContestRanking(username: $user) {
      attendedContestsCount rating globalRanking topPercentage
    }
    recentAcSubmissionList(username: $user, limit: 20) { title titleSlug timestamp lang }
  }
`;

// One request for every recent problem's difficulty, using aliased fields.
async function difficulties(slugs) {
  if (!slugs.length) return new Map();
  const fields = slugs
    .map((slug, index) => `q${index}: question(titleSlug: ${JSON.stringify(slug)}) { difficulty }`)
    .join("\n");
  const data = await query(`query { ${fields} }`);
  return new Map(slugs.map((slug, index) => [slug, data[`q${index}`]?.difficulty || null]));
}

const byDifficulty = rows => Object.fromEntries(rows.map(row => [row.difficulty.toLowerCase(), row.count]));

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
  const data = await query(PROFILE, { user: USER });
  const user = data.matchedUser;
  if (!user) throw new Error(`LeetCode user ${USER} not found`);

  // The recent list repeats a problem once per accepted submission.
  const seen = new Set();
  const recent = (data.recentAcSubmissionList || [])
    .filter(item => !seen.has(item.titleSlug) && seen.add(item.titleSlug))
    .slice(0, RECENT);
  const levels = await difficulties(recent.map(item => item.titleSlug));

  const contest = data.userContestRanking;
  const ranking = Number(user.profile?.ranking) || 0;

  const stats = {
    generatedAt: new Date().toISOString(),
    user: USER,
    solved: byDifficulty(user.submitStatsGlobal.acSubmissionNum),
    total: byDifficulty(data.allQuestionsCount),
    ranking: ranking > 0 && ranking < UNRANKED ? ranking : null,
    activeDays: Number(user.userCalendar?.totalActiveDays) || 0,
    languages: (user.languageProblemCount || [])
      .map(language => ({ name: language.languageName, solved: language.problemsSolved }))
      .sort((a, b) => b.solved - a.solved),
    contest: contest && contest.attendedContestsCount > 0
      ? {
          attended: contest.attendedContestsCount,
          rating: Math.round(contest.rating),
          globalRanking: contest.globalRanking,
          topPercentage: contest.topPercentage
        }
      : null,
    recent: recent.map(item => ({
      title: item.title,
      slug: item.titleSlug,
      difficulty: levels.get(item.titleSlug),
      lang: item.lang,
      solvedAt: new Date(Number(item.timestamp) * 1000).toISOString()
    }))
  };

  console.log(stats);

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
