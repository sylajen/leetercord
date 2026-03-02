import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "config", "users.json");
const SNAPSHOT_PATH = path.join(process.cwd(), "snapshots.json");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const USERS = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const DISCORD_WEBHOOK_URL = mustEnv("DISCORD_WEBHOOK_URL");

function readSnapshots() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    return { snapshots: {} };
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekRange() {
  const today = new Date();
  const dayOfWeek = today.getUTCDay();
  const diff = today.getUTCDate() - dayOfWeek; // Sunday is 0
  
  const sunday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), diff));
  const sundayISO = sunday.toISOString().slice(0, 10);
  const todayISO = today.toISOString().slice(0, 10);
  
  return { start: sundayISO, end: todayISO };
}

function getMonthRange() {
  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthStartISO = monthStart.toISOString().slice(0, 10);
  const todayISO = today.toISOString().slice(0, 10);
  
  return { start: monthStartISO, end: todayISO };
}

function getYearRange() {
  const today = new Date();
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const yearStartISO = yearStart.toISOString().slice(0, 10);
  const todayISO = today.toISOString().slice(0, 10);
  
  return { start: yearStartISO, end: todayISO };
}

function getSnapshotsInRange(snapshotsByDate, startDate, endDate) {
  const dates = Object.keys(snapshotsByDate)
    .filter(d => d >= startDate && d <= endDate)
    .sort();
  
  return { startDate, endDate, dates };
}

function calculateStats(user, snapshotsByDate, range) {
  const { dates, startDate } = range;
  
  if (dates.length === 0) {
    return { username: user.leetcode, easy: 0, medium: 0, hard: 0, change: 0 };
  }
  
  const firstSnapshot = snapshotsByDate[dates[0]]?.[user.leetcode];
  const lastSnapshot = snapshotsByDate[dates[dates.length - 1]]?.[user.leetcode];
  
  if (!firstSnapshot || !lastSnapshot) {
    return { username: user.leetcode, easy: 0, medium: 0, hard: 0, change: 0 };
  }
  
  const easyChange = Math.max(0, lastSnapshot.easy - firstSnapshot.easy);
  const mediumChange = Math.max(0, lastSnapshot.medium - firstSnapshot.medium);
  const hardChange = Math.max(0, lastSnapshot.hard - firstSnapshot.hard);
  const totalChange = Math.max(0, lastSnapshot.totalSolved - firstSnapshot.totalSolved);
  
  return {
    username: user.leetcode,
    easy: easyChange,
    medium: mediumChange,
    hard: hardChange,
    change: totalChange
  };
}

function formatSummary({ title, stats }) {
  const lines = [];
  lines.push(`**${title}**`);
  
  // Sort by total change descending
  const sorted = [...stats].sort((a, b) => b.change - a.change);
  
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    lines.push(
      `${i + 1}. \`${s.username}\` — **${s.change}** total (Easy - ${s.easy} · Medium - ${s.medium} · Hard - ${s.hard})`
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
  const snapshotsFile = readSnapshots();
  const snapshotsByDate = snapshotsFile.snapshots ?? {};
  
  const weekRange = getWeekRange();
  const monthRange = getMonthRange();
  const yearRange = getYearRange();
  
  const weekSnapshots = getSnapshotsInRange(snapshotsByDate, weekRange.start, weekRange.end);
  const monthSnapshots = getSnapshotsInRange(snapshotsByDate, monthRange.start, monthRange.end);
  const yearSnapshots = getSnapshotsInRange(snapshotsByDate, yearRange.start, yearRange.end);
  
  const weekStats = USERS.map(u => calculateStats(u, snapshotsByDate, weekSnapshots));
  const monthStats = USERS.map(u => calculateStats(u, snapshotsByDate, monthSnapshots));
  const yearStats = USERS.map(u => calculateStats(u, snapshotsByDate, yearSnapshots));
  
  const msg =
    formatSummary({ title: `Weekly Summary (${weekRange.start} → ${weekRange.end})`, stats: weekStats }) +
    "\n\n" +
    formatSummary({ title: `Monthly Summary (${monthRange.start} → ${monthRange.end})`, stats: monthStats }) +
    "\n\n" +
    formatSummary({ title: `Yearly Summary (${yearRange.start} → ${yearRange.end})`, stats: yearStats });
  
  await postToDiscord(msg);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
