/* =========================================================================
   Tiny JSON-file "database" for saved Survivors.
   Good enough for a hobby-scale bot: one small file, synchronous reads and
   writes, no external database to stand up. On Render's free plan this file
   lives on the service's local disk, which survives the service sleeping
   and waking back up, but is NOT guaranteed to survive a redeploy or a
   plan change — see the README for how to upgrade this if that matters
   to you (e.g. a Render persistent disk, or swapping this file for a real
   database).
   ========================================================================= */
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "characters.json");

function ensureFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "{}", "utf8");
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8") || "{}");
  } catch (e) {
    console.error("[db] failed to read/parse", DB_PATH, e);
    return {};
  }
}

function writeAll(all) {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(all, null, 2), "utf8");
}

function listForUser(userId) {
  const all = readAll();
  return all[userId] || [];
}

function saveForUser(userId, snapshot) {
  const all = readAll();
  const list = all[userId] || [];
  const idx = list.findIndex((c) => c.savedName.toLowerCase() === snapshot.savedName.toLowerCase());
  if (idx >= 0) list[idx] = snapshot;
  else list.push(snapshot);
  all[userId] = list;
  writeAll(all);
}

function deleteForUser(userId, name) {
  const all = readAll();
  const list = all[userId] || [];
  const next = list.filter((c) => c.savedName.toLowerCase() !== name.toLowerCase());
  const removed = next.length !== list.length;
  all[userId] = next;
  writeAll(all);
  return removed;
}

function getForUser(userId, name) {
  const list = listForUser(userId);
  return list.find((c) => c.savedName.toLowerCase() === name.toLowerCase()) || null;
}

module.exports = { listForUser, saveForUser, deleteForUser, getForUser };
