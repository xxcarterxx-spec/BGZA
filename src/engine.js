/* =========================================================================
   SURVIVOR FORGE — calculation engine (bot edition)
   Ported from the Survivor Forge web app. Every function here is pure and
   takes the character `state` as an explicit argument instead of closing
   over a module-level global, since this process serves many users'
   characters at once instead of one browser tab's worth of state.
   ========================================================================= */
const { ATTRS, mod, fmt, SKILLS, SKILL_BY_ID, FEAT_BY_ID, ATTR_NAME, ROLE_BY_ID } = require("./data");

function selectedRoles(state) {
  return state.roles.map((id) => (id ? ROLE_BY_ID[id] : null));
}

function roleAbilityBonusFor(state, attr) {
  let total = 0;
  selectedRoles(state).forEach((role, i) => {
    if (!role) return;
    const am = role.abilityMod;
    if (!am) return;
    if (am.any) {
      if (state.roleAbilityChoice[i] === attr) total += am.any;
    } else if (am.fixed && am.fixed[attr] != null) {
      total += am.fixed[attr];
    } else if (am.choice) {
      if (state.roleAbilityChoice[i] === attr) total += am.amount;
    }
  });
  return total;
}

function finalAttrs(state) {
  const out = {};
  ATTRS.forEach((a) => (out[a] = state.baseAttrs[a] + roleAbilityBonusFor(state, a)));
  return out;
}

function finalMods(state) {
  const fa = finalAttrs(state);
  const out = {};
  ATTRS.forEach((a) => (out[a] = mod(fa[a])));
  return out;
}

// gather every feat currently on the sheet: role-granted (resolved) + advancement
function activeFeats(state) {
  const out = []; // {featId, param, source}
  selectedRoles(state).forEach((role, i) => {
    if (!role || !role.featGrant) return;
    const fg = role.featGrant;
    let featId,
      param = null;
    if (fg.id) {
      featId = fg.id;
    } else if (fg.choice) {
      featId = state.roleFeatParam[i + "_choice"] || null;
    }
    if (!featId) return;
    if (fg.forceParam !== undefined) {
      param = fg.forceParam;
    }
    const feat = FEAT_BY_ID[featId];
    if (feat && feat.param && param == null) {
      param = state.roleFeatParam[i] || null;
    }
    out.push({ featId, param, source: "Role: " + role.name });
  });
  (state.advancement || []).forEach((a) => {
    if (a.type === "feat") out.push({ featId: a.featId, param: a.param || null, source: "Advancement" });
  });
  return out;
}

function skillTotals(state) {
  const fm = finalMods(state);
  const totals = {};
  const sources = {};
  SKILLS.forEach((s) => {
    totals[s.id] = fm[s.attr];
    sources[s.id] = [["Base (" + ATTR_NAME[s.attr].slice(0, 3) + " " + fmt(fm[s.attr]) + ")", fm[s.attr]]];
  });
  selectedRoles(state).forEach((role, i) => {
    if (!role) return;
    (role.skillBonuses || []).forEach((b) => {
      totals[b.skill] += b.amount;
      sources[b.skill].push([role.name + (b.note ? " (" + b.note + ")" : ""), b.amount]);
    });
    if (role.skillChoice) {
      const picks = state.roleSkillChoice[i] || [];
      picks.forEach((sk) => {
        totals[sk] += role.skillChoice.amount;
        sources[sk].push([role.name + " (chosen)", role.skillChoice.amount]);
      });
    }
    (role.flawEffects || []).forEach((fe) => {
      if (fe.skill) {
        totals[fe.skill] += fe.amount;
        sources[fe.skill].push([role.name + " Flaw" + (fe.note ? " (" + fe.note + ")" : ""), fe.amount]);
      }
    });
  });
  activeFeats(state).forEach((af) => {
    const feat = FEAT_BY_ID[af.featId];
    if (!feat) return;
    feat.effects.forEach((e) => {
      if (e.kind === "skill") {
        let targetSkill = e.target;
        if (feat.param && af.param) targetSkill = af.param;
        if (totals[targetSkill] == null) return;
        totals[targetSkill] += e.amount;
        sources[targetSkill].push([feat.name + (e.note ? " (" + e.note + ")" : ""), e.amount]);
      }
    });
  });
  (state.advancement || []).forEach((a) => {
    if (a.type === "skill") {
      totals[a.skill] += 2;
      sources[a.skill].push(["Advancement", 2]);
    }
  });
  return { totals, sources };
}

function saveTotals(state) {
  const fm = finalMods(state);
  const base = { con: fm.con, dex: fm.dex, wis: fm.wis }; // Fortitude=Con, Reflex=Dex, Will=Wis
  const totals = { con: base.con, dex: base.dex, wis: base.wis };
  const sources = {
    con: [["Base (Con " + fmt(base.con) + ")", base.con]],
    dex: [["Base (Dex " + fmt(base.dex) + ")", base.dex]],
    wis: [["Base (Wis " + fmt(base.wis) + ")", base.wis]],
  };
  selectedRoles(state).forEach((role) => {
    if (!role) return;
    (role.saveBonuses || []).forEach((b) => {
      totals[b.save] += b.amount;
      sources[b.save].push([role.name + (b.note ? " (" + b.note + ")" : ""), b.amount]);
    });
  });
  activeFeats(state).forEach((af) => {
    const feat = FEAT_BY_ID[af.featId];
    if (!feat) return;
    feat.effects.forEach((e) => {
      if (e.kind === "save") {
        totals[e.target] += e.amount;
        sources[e.target].push([feat.name + (e.note ? " (" + e.note + ")" : ""), e.amount]);
      }
    });
  });
  return { totals, sources }; // keys: con(Fortitude), dex(Reflex), wis(Will)
}

function derivedStats(state) {
  const fm = finalMods(state);
  let health = 10 + fm.con * 2;
  let speed = 20 + fm.dex * 5;
  let bulk = Math.max(1, 5 + fm.str);
  let bulkMult = 1;
  activeFeats(state).forEach((af) => {
    const feat = FEAT_BY_ID[af.featId];
    if (!feat) return;
    feat.effects.forEach((e) => {
      if (e.kind === "derived") {
        if (e.target === "health") health += e.amount;
        if (e.target === "speed") speed += e.amount;
        if (e.target === "bulkmult") bulkMult += e.amount;
      }
    });
  });
  selectedRoles(state).forEach((role) => {
    if (!role) return;
    (role.flawEffects || []).forEach((fe) => {
      if (fe.derived === "speed") speed += fe.amount;
    });
  });
  // added armor's AC bonus / Dex cap (from the optional gear step)
  let armorBonus = 0,
    dexCap = null;
  (state.customArmor || []).forEach((it) => {
    if (it.acBonus) armorBonus += it.acBonus;
    if (it.dexCap != null) dexCap = dexCap == null ? it.dexCap : Math.min(dexCap, it.dexCap);
  });
  let dexForDefense = fm.dex;
  if (dexCap != null) dexForDefense = Math.min(dexForDefense, dexCap);
  const defense = 10 + dexForDefense + armorBonus;
  bulk = Math.round(bulk * bulkMult * 10) / 10;
  return { health, speed, defense, bulk, armorBonus };
}

function pointBuyCost(score) {
  // cost to raise FROM 8 TO score, cumulative
  let cost = 0;
  for (let s = 9; s <= score; s++) cost += s <= 13 ? 1 : 2;
  return cost;
}
function pointBuySpent(state) {
  let total = 0;
  ATTRS.forEach((a) => (total += pointBuyCost(state.baseAttrs[a])));
  return total;
}

module.exports = {
  selectedRoles,
  roleAbilityBonusFor,
  finalAttrs,
  finalMods,
  activeFeats,
  skillTotals,
  saveTotals,
  derivedStats,
  pointBuyCost,
  pointBuySpent,
};
