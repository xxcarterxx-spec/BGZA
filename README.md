# Survivor Forge — Discord Bot

A Discord version of the Survivor Forge character builder for *Bubba's Guide
to the Zombie Apocalypse*. Run `/survivor build` in a server the bot is in,
and it walks you through picking two Roles, entering attributes, choosing a
Kit and gear, and naming your Survivor — then posts a finished character
sheet, with options to save it, export it as a text file, or share it to the
channel.

This reuses the exact same rules data and calculation engine as the web
version (Survivor Forge), so totals match.

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Name it whatever you like (e.g. "Survivor Forge").
2. Open the **Bot** tab. Click **Reset Token** to generate a bot token, and copy it somewhere safe — this is `DISCORD_TOKEN` below. Treat it like a password; anyone with it can control the bot.
3. Still on the **Bot** tab, you don't need to turn on any of the "Privileged Gateway Intents" toggles (Message Content, Presence, Server Members) — this bot only uses slash commands and buttons/menus, never raw message text.
4. Open the **OAuth2 → URL Generator** tab. Under **Scopes**, check `bot` and `applications.commands`. Under **Bot Permissions**, check `Send Messages`, `Use Slash Commands`, `Embed Links`, and `Attach Files`.
5. Copy the generated URL at the bottom, open it in a browser, and choose the server to add the bot to.
6. On the **General Information** tab, copy the **Application ID** — this is `CLIENT_ID` below.

## 2. Run it locally first (recommended)

```
npm install
cp .env.example .env
```

Fill in `.env` with your `DISCORD_TOKEN` and `CLIENT_ID`. Also set `GUILD_ID`
to the ID of your test server (right-click the server icon in Discord with
Developer Mode on → Copy Server ID) — this makes the slash command appear
instantly there instead of waiting up to an hour for a global rollout.

Register the command, then start the bot:

```
npm run deploy-commands
npm start
```

In your test server, run `/survivor build`.

## 3. Deploy to Render

**Option A — Blueprint (easiest):** push this project to a GitHub repo, then
in the Render dashboard choose **New → Blueprint** and point it at the repo.
Render reads `render.yaml` and creates the service for you. Add
`DISCORD_TOKEN` and `CLIENT_ID` (and `GUILD_ID` if you're using one) under
the service's **Environment** tab, since those are secrets and aren't stored
in `render.yaml`.

**Option B — manual:** New → Web Service → connect the repo → Environment:
`Node` → Build Command: `npm install` → Start Command: `npm start`. Add the
same environment variables under the **Environment** tab.

After the first deploy, register the slash command against your production
bot once, from your own machine (point `.env` at the same `DISCORD_TOKEN`/
`CLIENT_ID` you gave Render — you don't need `GUILD_ID` this time if you
want it available in every server):

```
npm run deploy-commands
```

You only need to re-run this if you change the command's structure later
(new subcommand, new option, etc.) — not on every deploy.

### The free-tier sleep issue (important)

Render's free plan only offers **Web Services**, which spin down after a
period of no HTTP traffic — but a Discord bot needs to stay connected to
Discord's gateway around the clock. `index.js` starts a small Express server
answering `GET /` specifically so Render treats this as a normal web
service, but that alone doesn't stop it from sleeping.

To actually keep it awake on the free plan, point a free external uptime
monitor (e.g. UptimeRobot, cron-job.org) at your Render URL and have it hit
`/` every 10 minutes or so. This works, but it's a workaround, not a
guarantee — if a ping is missed and the service falls asleep, the bot is
offline until the next request wakes it back up, and there's no way to
avoid a moment of cold-start lag on wake.

If the bot needs to be reliably online (e.g. other people depend on it),
the straightforward fix is upgrading that one service to a paid Render plan
— paid services don't spin down, so the keep-alive ping becomes unnecessary.

### Saved-character storage (important)

Saved Survivors are stored in a small JSON file (`data/characters.json` by
default — see `DB_PATH` in `.env.example`) on the service's local disk. That
survives the free plan's sleep/wake cycle, but is **not** guaranteed to
survive a redeploy (a new build can start from a clean filesystem). For a
personal or small-group bot this is usually fine — if you need saved
characters to be bulletproof, add a
[Render Persistent Disk](https://render.com/docs/disks) mounted at the `data/`
folder, or swap `src/db.js` for a real database (e.g. Render's free
key-value store, or Postgres).

## Using the bot

- `/survivor build` — start a new Survivor. Ephemeral (only you see it), so it won't clutter the channel.
- `/survivor roll` — rolls 4d6-drop-lowest six times for the Roll & Arrange attribute method.
- `/survivor sheet [name]` — show one of your saved Survivors.
- `/survivor list` — list your saved Survivors.
- `/survivor delete <name>` — delete a saved Survivor.
- `/survivor cancel` — cancel a build in progress.

On the finished sheet: **Save** stores it under your Discord account,
**Export as file** sends you a `.txt` copy, **Share to channel** posts a
public copy of the sheet, and **Start over** discards it and begins again.

## Known differences from the web app

- **Weapons are flavor text only.** The web app's shopping catalog of ~70
  individual weapons doesn't translate well to Discord's 25-option select
  menus, so weapons/misc gear are entered as a freeform note instead. Armor
  *is* mechanically wired up (it affects Defense), since the full armor list
  fits in one select menu.
- **One build at a time per person**, and an in-progress build lives in the
  bot's memory rather than being saved anywhere — if the bot restarts
  mid-build, that session is gone (finished, saved characters are
  unaffected). Discord also expires interaction tokens after about 15
  minutes, so it's best to finish a build in one sitting.
- Advancement (post-Scenario attribute/Feat/skill bumps) from the web app
  isn't implemented here yet — this covers Steps One through Nine of
  character creation, not campaign play.
