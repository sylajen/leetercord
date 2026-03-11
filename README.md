# LeetCord - LeetCode Discord Leaderboard

A simple bot that posts LeetCode progress leaderboards to Discord multiple times a day. Perfect for keeping your study group motivated and competitive!

## What This Does

This bot tracks LeetCode problem-solving progress for a group of users and posts updates to a Discord channel via webhook. It shows:

- **Daily progress** - how many problems each person solved since yesterday
- **Weekly progress** - problems solved in the current Sunday-Saturday week
- **Time-stamped updates** - 4 updates per day (9 AM, 1 PM, 6 PM, 11:30 PM EST)
- **Weekly summaries** - every Sunday at noon with detailed breakdowns by difficulty (Easy/Medium/Hard)

The bot runs automatically via GitHub Actions, fetches fresh stats from LeetCode's public API, and keeps a history in `snapshots.json`.

## How It Works

1. **GitHub Actions** runs the script on a schedule (4 times daily + Sunday summaries)
2. **LeetCode GraphQL API** gets the current problem counts for each user
3. **Snapshot system** compares today's counts with previous days to calculate deltas
4. **Discord webhook** posts formatted leaderboards to your channel

All times use **EST/EDT** (America/New_York timezone) so the "day" boundaries match when you're actually solving problems.

## Setup (If You Fork This)

### 1. Add Your Users

Edit `config/users.json` with your group members:

```json
[
  { "name": "Your Name", "leetcode": "your-leetcode-username" },
  { "name": "Friend", "leetcode": "their-username" }
]
```

The `leetcode` field must match their exact LeetCode username (case-sensitive).

### 2. Set Up Discord Webhook

1. Go to your Discord server → Channel Settings → Integrations → Webhooks
2. Create a new webhook and copy the URL
3. In your GitHub repo: Settings → Secrets and variables → Actions → New repository secret
4. Name: `DISCORD_WEBHOOK_URL`
5. Value: Paste your webhook URL

### 3. Enable GitHub Actions

1. Go to your repo's **Actions** tab
2. If workflows are disabled, enable them
3. The bot will start running on the schedules defined in `.github/workflows/leetcode.yml`

### 4. Customize Schedules (Optional)

Edit `.github/workflows/leetcode.yml` to change when updates run:

```yaml
schedule:
  - cron: "0 14 * * *"   # 9 AM EST
  - cron: "0 18 * * *"   # 1 PM EST
  - cron: "0 23 * * *"   # 6 PM EST
  - cron: "30 4 * * *"   # 11:30 PM EST
  - cron: "0 17 * * 0"   # 12 PM EST Sundays (weekly summary)
```

Cron times are in **UTC**, so adjust based on your timezone. EST = UTC-5, EDT = UTC-4.

## Files You Might Care About

- **`config/users.json`** - your group's LeetCode usernames
- **`scripts/run.mjs`** - main script that posts daily updates
- **`scripts/weekly-summary.mjs`** - Sunday summary with difficulty breakdown
- **`snapshots.json`** - historical data (auto-updated by the bot)
- **`.github/workflows/leetcode.yml`** - schedule configuration

## Troubleshooting

**"Could not read profiles for..."** - The LeetCode username might be wrong, or the profile is private/doesn't exist.

**Bot not posting** - Check that:
- GitHub Actions are enabled in your repo
- The `DISCORD_WEBHOOK_URL` secret is set correctly
- The webhook URL is still valid in Discord

**Wrong timezone** - The bot uses EST/EDT. If you want a different timezone, edit `REPORT_TZ` in both script files.

**Want to test locally?** Run:
```bash
DISCORD_WEBHOOK_URL="your-webhook-url" npm run run
```

## How Snapshots Work

The bot saves a snapshot of everyone's total problems solved at each run. When calculating deltas:

- **Daily** = today's snapshot - yesterday's snapshot
- **Weekly** = today's snapshot - baseline snapshot from the current Sunday-Saturday week

This means if someone solves 3 problems between 9 AM and 1 PM, the 1 PM update will show those 3 as part of their "daily" count. The system is cumulative throughout each EST day.

## Credits

Built with Node.js, GitHub Actions, and the LeetCode GraphQL API. No external npm packages needed—just vanilla JavaScript and web APIs.

---

**Fork it, customize it, and keep grinding those LeetCode problems! 💪**
