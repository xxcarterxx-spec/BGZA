/* =========================================================================
   In-progress build sessions, kept in memory (one per user, keyed by
   Discord user id). This is intentionally not persisted — an in-progress
   build is a few minutes of back-and-forth, and Discord's own interaction
   tokens expire after ~15 minutes anyway, so there's nothing to gain from
   surviving a bot restart mid-wizard. Finished characters are saved
   separately via db.js.
   ========================================================================= */
const { ROLE_BY_ID, FEAT_BY_ID } = require("./data");

const sessions = new Map();

function freshSession(userId) {
  return {
    userId,
    step: "roles",
    roles: [null, null],
    roleAbilityChoice: {},
    roleSkillChoice: {},
    roleFeatParam: {},
    baseAttrs: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    advancement: [],
    customArmor: [],
    gearText: "",
    kitId: null,
    name: "",
    background: "",
    grabbed: "",
    pending: [], // queue of follow-up prompts still owed for the roles just picked
  };
}

function start(userId) {
  const s = freshSession(userId);
  sessions.set(userId, s);
  return s;
}

function get(userId) {
  return sessions.get(userId) || null;
}

function clear(userId) {
  sessions.delete(userId);
}

// Build the queue of follow-up prompts owed once both Roles are picked:
// ability-score choices, bonus-skill choices, and feat choices/params.
// Order: role 0's prompts, then role 1's — each role's ability choice
// before its skill choice before its feat choice/param, matching the
// order the web app resolves them in.
function buildPendingQueue(session) {
  const queue = [];
  session.roles.forEach((roleId, i) => {
    if (!roleId) return;
    const role = ROLE_BY_ID[roleId];
    const am = role.abilityMod;
    if (am && (am.any || am.choice)) {
      queue.push({ type: "ability", roleIdx: i });
    }
    if (role.skillChoice) {
      queue.push({ type: "skill", roleIdx: i, count: role.skillChoice.count });
    }
    const fg = role.featGrant;
    if (fg) {
      if (fg.choice) {
        queue.push({ type: "featChoice", roleIdx: i, options: fg.choice });
        // whether a param prompt follows depends on which feat gets picked,
        // so that gets appended dynamically once the choice is answered
      } else if (fg.id) {
        const feat = FEAT_BY_ID[fg.id];
        if (feat && feat.param && fg.forceParam === undefined) {
          queue.push({ type: "featParam", roleIdx: i, kind: feat.param, featName: feat.name });
        }
      }
    }
  });
  return queue;
}

module.exports = { start, get, clear, freshSession, buildPendingQueue };
