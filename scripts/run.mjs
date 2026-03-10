import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_PATH = path.join(process.cwd(), "snapshots.json");
const CONFIG_PATH = path.join(process.cwd(), "config", "users.json");
const REPORT_TZ = "America/New_York";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Read users from config/users.json instead of env vars
const USERS = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const DISCORD_WEBHOOK_URL = mustEnv("DISCORD_WEBHOOK_URL");

// ---- LeetCode GraphQL fetch ----
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

function dateISOInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function shiftISODate(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function todayISO() {
  return dateISOInTimeZone(new Date(), REPORT_TZ);
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

function getLatestUserSnapshotBefore(snapshotsByDate, username, beforeDate) {
  const dates = Object.keys(snapshotsByDate).sort().reverse(); // descending
  for (const d of dates) {
    if (d >= beforeDate) continue;
    const row = snapshotsByDate[d]?.[username];
    if (row) return row;
  }
  return null;
}

function getUserBaselineTotal({ snapshotsByDate, username, preferredDate, rangeStart, rangeEnd }) {
  const preferred = preferredDate ? snapshotsByDate[preferredDate]?.[username]?.totalSolved : undefined;
  if (preferred !== undefined) return preferred;

  const dates = Object.keys(snapshotsByDate).sort(); // ascending
  for (const d of dates) {
    if (rangeStart && d < rangeStart) continue;
    if (rangeEnd && d > rangeEnd) break;
    const total = snapshotsByDate[d]?.[username]?.totalSolved;
    if (total !== undefined) return total;
  }

  return null;
}

function formatCombinedTable({ dailyRows, weeklyRows, dailySince, weeklySince }) {
  // Create a map of username -> {daily, weekly, total}
  const dataByUser = new Map();
  
  dailyRows.forEach(d => {
    dataByUser.set(d.username, { daily: d.delta, total: d.totalSolved });
  });
  
  weeklyRows.forEach(w => {
    const existing = dataByUser.get(w.username) || {};
    dataByUser.set(w.username, { ...existing, weekly: w.delta });
  });
  
  // Sort by weekly delta descending
  const sorted = Array.from(dataByUser.entries())
    .map(([username, data]) => ({ username, ...data }))
    .sort((a, b) => (b.weekly || 0) - (a.weekly || 0));

  const nameWidth = Math.max(4, ...sorted.map(r => r.username.length));
  const dailyWidth = Math.max(5, ...sorted.map(r => String(r.daily ?? 0).length));
  const weeklyWidth = Math.max(6, ...sorted.map(r => String(r.weekly ?? 0).length));
  const totalWidth = Math.max(5, ...sorted.map(r => String(r.total ?? 0).length));

  const pad = (value, width) => String(value).padEnd(width, " ");

  const lines = [];
  lines.push(`**LeetCode Progress** (Daily since ${dailySince} · Weekly since ${weeklySince})`);
  lines.push("");
  lines.push("```");
  lines.push(`${pad("User", nameWidth)}  ${pad("Daily", dailyWidth)}  ${pad("Weekly", weeklyWidth)}  ${pad("Total", totalWidth)}`);
  lines.push(`${"-".repeat(nameWidth)}  ${"-".repeat(dailyWidth)}  ${"-".repeat(weeklyWidth)}  ${"-".repeat(totalWidth)}`);

  sorted.forEach(row => {
    lines.push(
      `${pad(row.username, nameWidth)}  ${pad(row.daily ?? 0, dailyWidth)}  ${pad(row.weekly ?? 0, weeklyWidth)}  ${pad(row.total ?? 0, totalWidth)}`
    );
  });

  lines.push("```");

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
    const s = await fetchLeetCodeStats(u.leetcode);
    if (!s) {
      const fallback = getLatestUserSnapshotBefore(snapshotsByDate, u.leetcode, dateToday);
      if (fallback) {
        stats.push({ ...fallback, username: u.leetcode, missing: true });
      } else {
        stats.push({ username: u.leetcode, totalSolved: 0, easy: 0, medium: 0, hard: 0, missing: true });
      }
    } else {
      stats.push({ ...s, username: u.leetcode });
    }
  }

  // Save today's snapshot
  snapshotsByDate[dateToday] = Object.fromEntries(stats.map(s => [s.username, s]));
  snapshotsFile.snapshots = snapshotsByDate;
  writeSnapshots(snapshotsFile);

  // Compute daily delta using EST yesterday (or latest prior day)
  const yesterday = shiftISODate(dateToday, -1);
  const prevDaily = getSnapshotOnOrBefore(snapshotsByDate, yesterday);

  const dailyRows = stats.map(s => {
    const prev = getUserBaselineTotal({
      snapshotsByDate,
      username: s.username,
      preferredDate: prevDaily?.date,
      rangeStart: prevDaily?.date,
      rangeEnd: dateToday
    }) ?? s.totalSolved;
    return { username: s.username, totalSolved: s.totalSolved, delta: Math.max(0, s.totalSolved - prev) };
  }).sort((a, b) => b.delta - a.delta);

  // Compute weekly delta using oldest snapshot within last 7 EST days
  const sevenDaysAgo = shiftISODate(dateToday, -7);
  const dates = Object.keys(snapshotsByDate).sort(); // ascending order
  const oldestInRange = dates.find(d => d >= sevenDaysAgo && d <= dateToday);
  const prevWeekly = oldestInRange ? { date: oldestInRange, data: snapshotsByDate[oldestInRange] } : null;

  const weeklyRows = stats.map(s => {
    const prev = getUserBaselineTotal({
      snapshotsByDate,
      username: s.username,
      preferredDate: prevWeekly?.date,
      rangeStart: prevWeekly?.date ?? sevenDaysAgo,
      rangeEnd: dateToday
    }) ?? s.totalSolved;
    return { username: s.username, totalSolved: s.totalSolved, delta: Math.max(0, s.totalSolved - prev) };
  }).sort((a, b) => b.delta - a.delta);

  const missing = stats.filter(s => s.missing).map(s => s.username);
  const note = missing.length
    ? `\n\n⚠️ Could not read profiles for: ${missing.map(u => `\`${u}\``).join(", ")} (check usernames / profile availability).`
    : "";

  // Get current time in EST
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORT_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const currentTime = timeFormatter.format(now);
  const currentDate = dateFormatter.format(now);
  const isFirstRun = process.env.REPORT_SLOT === "morning";

  const header = isFirstRun ? `# 📅 ${currentDate}\n\n` : "";
  const timeStamp = `_Update at ${currentTime} EST_\n\n`;

  const msg =
    header +
    timeStamp +
    formatCombinedTable({
      dailyRows,
      weeklyRows,
      dailySince: prevDaily?.date ?? "last snapshot",
      weeklySince: prevWeekly?.date ?? "last snapshot"
    }) +
    note;

  await postToDiscord(msg);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
