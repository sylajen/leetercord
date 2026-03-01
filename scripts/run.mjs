import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_PATH = path.join(process.cwd(), "snapshots.json");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const USERS = mustEnv("LEETCODE_USERS")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const DISCORD_WEBHOOK_URL = mustEnv("DISCORD_WEBHOOK_URL");

// ---- LeetCode GraphQL fetch (public; no login) ----
async function fetchLeetCodeStats(username) {
  const query = `
    query userPublicProfile($username: String!) {
      matchedUser(username: $username) {
        username
        submitStatsGlobal {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;

  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // user-agent helps avoid some edge throttles
      "user-agent": "leetcode-discord-leaderboard/1.0"
    },
    body: JSON.stringify({ query, variables: { username } })
  });

  if (!res.ok) {
    throw new Error(`LeetCode HTTP ${res.status} for ${username}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`LeetCode GraphQL error for ${username}: ${JSON.stringify(json.errors)}`);
  }

  const user = json?.data?.matchedUser;
  if (!user) {
    // user might not exist or profile is unavailable
    return null;
  }

  const arr = user.submitStatsGlobal?.acSubmissionNum ?? [];
  const byDiff = Object.fromEntries(arr.map(x => [x.difficulty, x.count]));
  const totalSolved = byDiff.All ?? 0;

  return {
    username: user.username,
    totalSolved,
    easy: byDiff.Easy ?? 0,
    medium: byDiff.Medium ?? 0,
    hard: byDiff.Hard ?? 0
  };
}

function todayISO() {
  // Use UTC date to avoid DST/timezone weirdness in Actions.
  // If you want Toronto-local “day”, we can adjust later.
  return new Date().toISOString().slice(0, 10);
}

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return { snapshots: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

function writeSnapshots(data) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function getSnapshotOnOrBefore(snapshotsByDate, targetDate) {
  // snapshotsByDate: { "YYYY-MM-DD": { username: {totalSolved...}, ... }, ... }
  const dates = Object.keys(snapshotsByDate).sort(); // ascending
  let chosen = null;
  for (const d of dates) {
    if (d <= targetDate) chosen = d;
    else break;
  }
  return chosen ? { date: chosen, data: snapshotsByDate[chosen] } : null;
}

function formatLeaderboard({ title, rows }) {
  const lines = [];
  lines.push(`**${title}**`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(
      `${i + 1}. \`${r.username}\` — **${r.delta}** (${r.totalSolved} total)`
    );
  }
  return lines.join("\n");
}

async function postToDiscord(content) {
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${res.status}: ${text}`);
  }
}

async function main() {
  if (USERS.length === 0) throw new Error("No users in LEETCODE_USERS");

  const snapshotsFile = readSnapshots();
  const snapshotsByDate = snapshotsFile.snapshots ?? {};

  const dateToday = todayISO();

  // Fetch all users (sequential to be gentle; 4 users is fine)
  const stats = [];
  for (const u of USERS) {
    const s = await fetchLeetCodeStats(u);
    if (!s) {
      stats.push({ username: u, totalSolved: 0, easy: 0, medium: 0, hard: 0, missing: true });
    } else {
      stats.push(s);
    }
  }

  // Save today's snapshot
  snapshotsByDate[dateToday] = Object.fromEntries(stats.map(s => [s.username, s]));
  snapshotsFile.snapshots = snapshotsByDate;
  writeSnapshots(snapshotsFile);

  // Compute daily delta using yesterday (or latest prior day)
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prevDaily = getSnapshotOnOrBefore(snapshotsByDate, yesterday);
  const prevDailyData = prevDaily?.data ?? {};

  const dailyRows = stats.map(s => {
    const prev = prevDailyData[s.username]?.totalSolved ?? s.totalSolved;
    return { username: s.username, totalSolved: s.totalSolved, delta: Math.max(0, s.totalSolved - prev) };
  }).sort((a, b) => b.delta - a.delta);

  // Compute weekly delta using 7 days ago (or nearest prior)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const prevWeekly = getSnapshotOnOrBefore(snapshotsByDate, sevenDaysAgo);
  const prevWeeklyData = prevWeekly?.data ?? {};

  const weeklyRows = stats.map(s => {
    const prev = prevWeeklyData[s.username]?.totalSolved ?? s.totalSolved;
    return { username: s.username, totalSolved: s.totalSolved, delta: Math.max(0, s.totalSolved - prev) };
  }).sort((a, b) => b.delta - a.delta);

  const missing = stats.filter(s => s.missing).map(s => s.username);
  const note = missing.length
    ? `\n\n⚠️ Could not read profiles for: ${missing.map(u => `\`${u}\``).join(", ")} (check usernames / profile availability).`
    : "";

  const msg =
    formatLeaderboard({ title: `LeetCode Daily (+ since ${prevDaily?.date ?? "last snapshot"})`, rows: dailyRows }) +
    "\n\n" +
    formatLeaderboard({ title: `LeetCode Weekly (+ since ${prevWeekly?.date ?? "last snapshot"})`, rows: weeklyRows }) +
    note;

  await postToDiscord(msg);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});