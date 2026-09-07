/* =========================================================================
   Wizard step rendering + state transitions.
   Every render* function returns a plain { embeds, components } object
   ready to hand to interaction.update()/reply(). Every handle* function
   mutates the session in place and returns the render for whatever step
   comes next, so the router in index.js can stay a thin dispatcher.
   ========================================================================= */
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  ATTRS,
  ATTR_NAME,
  mod,
  fmt,
  SKILLS,
  ROLES,
  ROLE_BY_ID,
  FEAT_BY_ID,
  KITS,
  KIT_BY_ID,
  ARMOR,
} = require("./data");
const engine = require("./engine");
const { buildPendingQueue } = require("./session");

const MAROON = 0x6e1414;
const OLIVE = 0x5c6b3f;

function trunc(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ---------------- Step: Roles ---------------- */
function renderRolesStep() {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Survivor Forge — Pick Two Roles")
    .setDescription(
      "Every Survivor is built from two Roles, not one — together they're the mechanical and narrative backbone of who this person is.\n\nPick exactly two from the list below."
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId("sf_roles")
    .setPlaceholder("Choose two Roles…")
    .setMinValues(2)
    .setMaxValues(2)
    .addOptions(
      ROLES.map((r) => ({
        label: r.name,
        description: trunc(r.hook, 100),
        value: r.id,
      }))
    );
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), cancelRow] };
}

function abilityModLabel(role) {
  const am = role.abilityMod;
  if (!am) return "—";
  if (am.fixed) {
    return Object.entries(am.fixed)
      .map(([k, v]) => `${fmt(v)} ${ATTR_NAME[k]}`)
      .join(", ");
  }
  if (am.any) return `+${am.any} to any one attribute`;
  if (am.choice) return `+${am.amount} to one of a few attributes`;
  return "—";
}

/* ---------------- Pending follow-up prompts (ability/skill/feat) ---------------- */
function renderPendingStep(session) {
  const prompt = session.pending[0];
  const role = ROLE_BY_ID[session.roles[prompt.roleIdx]];

  if (prompt.type === "ability") {
    const embed = new EmbedBuilder()
      .setColor(MAROON)
      .setTitle(`${role.name} — Attribute Modifier`)
      .setDescription(`${role.name} grants **${abilityModLabel(role)}**. Which attribute gets it?`);
    const select = new StringSelectMenuBuilder()
      .setCustomId("sf_ability")
      .setPlaceholder("Choose an attribute…")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(ATTRS.map((a) => ({ label: ATTR_NAME[a], value: a })));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  if (prompt.type === "skill") {
    const embed = new EmbedBuilder()
      .setColor(MAROON)
      .setTitle(`${role.name} — Bonus Skills`)
      .setDescription(
        `${role.name} grants +${role.skillChoice.amount} to **${prompt.count}** skill${
          prompt.count > 1 ? "s" : ""
        } of your choice. Pick ${prompt.count}.`
      );
    const select = new StringSelectMenuBuilder()
      .setCustomId("sf_skill")
      .setPlaceholder(`Choose ${prompt.count} skill${prompt.count > 1 ? "s" : ""}…`)
      .setMinValues(prompt.count)
      .setMaxValues(prompt.count)
      .addOptions(SKILLS.map((s) => ({ label: s.name, description: trunc(s.desc, 100), value: s.id })));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  if (prompt.type === "featChoice") {
    const embed = new EmbedBuilder()
      .setColor(MAROON)
      .setTitle(`${role.name} — Choose a Feat`)
      .setDescription(`${role.name} lets you pick one of these two Feats.`);
    const select = new StringSelectMenuBuilder()
      .setCustomId("sf_featchoice")
      .setPlaceholder("Choose a Feat…")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        prompt.options.map((fid) => ({
          label: FEAT_BY_ID[fid].name,
          description: trunc(FEAT_BY_ID[fid].desc, 100),
          value: fid,
        }))
      );
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  if (prompt.type === "featParam") {
    const embed = new EmbedBuilder()
      .setColor(MAROON)
      .setTitle(`${role.name} — ${prompt.featName}`)
      .setDescription(
        prompt.kind === "skill"
          ? `${prompt.featName} needs a Skill. Which one?`
          : `${prompt.featName} needs Melee or Ranged. Which one?`
      );
    const options =
      prompt.kind === "skill"
        ? SKILLS.map((s) => ({ label: s.name, value: s.id }))
        : [
            { label: "Melee", value: "melee" },
            { label: "Ranged", value: "ranged" },
          ];
    const select = new StringSelectMenuBuilder()
      .setCustomId("sf_featparam")
      .setPlaceholder("Choose…")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
  }

  // shouldn't happen
  return renderAttrsIntro(session);
}

/* ---------------- Step: Attributes ---------------- */
function renderAttrsIntro(session) {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Attributes")
    .setDescription(
      [
        "Agree on one method as a table, then hit **Enter Scores** and type your six final numbers as Str, Dex, Con, Int, Wis, Cha.",
        "",
        "**Standard Array** — use 15, 14, 13, 12, 10, 8, one each.",
        "**Point Buy (27 pts)** — start every attribute at 8; 1 point per point up to 13, 2 points per point from 14–15.",
        "**Roll & Arrange** — use `/survivor roll` to roll 4d6-drop-lowest six times, then arrange the results.",
        "**Manual Entry** — type whatever your table agreed on.",
        "",
        "Role bonuses from your two Roles are applied automatically after you enter your base scores.",
      ].join("\n")
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_attrs_open").setLabel("Enter Scores").setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

function attrsModal() {
  const modal = new ModalBuilder().setCustomId("sf_attrs_modal").setTitle("Attribute Scores");
  const input = new TextInputBuilder()
    .setCustomId("scores")
    .setLabel("Str, Dex, Con, Int, Wis, Cha")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("15,14,13,12,10,8")
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function parseAttrsInput(raw) {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length);
  if (parts.length !== 6) return { error: "Enter exactly six numbers, separated by commas (e.g. `15,14,13,12,10,8`)." };
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || !Number.isInteger(n))) {
    return { error: "Those need to be whole numbers." };
  }
  const baseAttrs = {};
  ATTRS.forEach((a, i) => (baseAttrs[a] = nums[i]));
  return { baseAttrs };
}

/* ---------------- Step: Kit ---------------- */
function renderKitStep() {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Choose a Kit")
    .setDescription("Take a Kit from Chapter Five, or skip it — this is what your Survivor is carrying when the story starts.");
  KITS.forEach((k) => {
    embed.addFields({ name: k.name, value: `*${k.quote}*\n${k.items.join(", ")}` });
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId("sf_kit")
    .setPlaceholder("Choose a Kit…")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([
      ...KITS.map((k) => ({ label: k.name, description: trunc(k.quote, 100), value: k.id })),
      { label: "No kit — skip this", value: "none" },
    ]);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

/* ---------------- Step: Optional armor pick ---------------- */
function flattenArmor() {
  const out = [];
  Object.entries(ARMOR).forEach(([category, rows]) => {
    rows.forEach(([name, ac, dexStr, weight]) => {
      const key = `${category}::${name}`;
      out.push({
        key,
        name,
        category,
        weight,
        acBonus: ac === "—" ? 0 : parseInt(ac.replace("−", "-"), 10),
        dexCap: dexStr === "—" || dexStr == null ? null : parseInt(dexStr.replace("−", "-"), 10),
      });
    });
  });
  return out;
}
const ARMOR_FLAT = flattenArmor();
const ARMOR_BY_KEY = Object.fromEntries(ARMOR_FLAT.map((a) => [a.key, a]));

function renderArmorStep() {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Additional Armor (optional)")
    .setDescription("Pick up to 3 pieces of armor from Chapter Five's gear list, or skip straight to final details.");
  const select = new StringSelectMenuBuilder()
    .setCustomId("sf_armor")
    .setPlaceholder("Choose armor (optional)…")
    .setMinValues(0)
    .setMaxValues(Math.min(3, ARMOR_FLAT.length))
    .addOptions(
      ARMOR_FLAT.map((a) => ({
        label: a.name,
        description: `${a.category} · AC ${fmt(a.acBonus)}${a.dexCap != null ? `, Dex cap ${a.dexCap}` : ""}`,
        value: a.key,
      }))
    );
  const skipRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_armor_skip").setLabel("Skip armor").setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select), skipRow] };
}

/* ---------------- Step: Gear notes (freeform) ---------------- */
function renderGearIntro() {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Weapons & Other Gear (optional)")
    .setDescription(
      "Jot down any weapons or extra gear by name — this is flavor for the sheet only; it doesn't affect your numbers."
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_gear_open").setLabel("Add gear notes").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("sf_gear_skip").setLabel("Skip").setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

function gearModal() {
  const modal = new ModalBuilder().setCustomId("sf_gear_modal").setTitle("Weapons & Other Gear");
  const input = new TextInputBuilder()
    .setCustomId("gear")
    .setLabel("Weapons / other gear")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Machete, Kitchen Knife, half a tank of gas…")
    .setRequired(false)
    .setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/* ---------------- Step: Final details ---------------- */
function renderDetailsIntro() {
  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle("Final Details")
    .setDescription("Name your Survivor and sketch a short background. Almost done.");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_details_open").setLabel("Enter Details").setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

function detailsModal() {
  const modal = new ModalBuilder().setCustomId("sf_details_modal").setTitle("Final Details");
  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Survivor's name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(60);
  const background = new TextInputBuilder()
    .setCustomId("background")
    .setLabel("Background (a sentence or two)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(400);
  const grabbed = new TextInputBuilder()
    .setCustomId("grabbed")
    .setLabel("Grabbed without thinking")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);
  modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(background),
    new ActionRowBuilder().addComponents(grabbed)
  );
  return modal;
}

/* ---------------- Final sheet ---------------- */
function buildSheetEmbed(session) {
  const roles = session.roles.map((id) => ROLE_BY_ID[id]);
  const fa = engine.finalAttrs(session);
  const fm = engine.finalMods(session);
  const derived = engine.derivedStats(session);
  const saves = engine.saveTotals(session).totals;
  const skills = engine.skillTotals(session).totals;
  const feats = engine.activeFeats(session);
  const kit = session.kitId && session.kitId !== "none" ? KIT_BY_ID[session.kitId] : null;

  const embed = new EmbedBuilder()
    .setColor(MAROON)
    .setTitle(session.name || "Unnamed Survivor")
    .setDescription(
      [roles.map((r) => r.name).join(" / "), session.background ? `*${session.background}*` : null]
        .filter(Boolean)
        .join("\n")
    )
    .addFields(
      {
        name: "Attributes",
        value: ATTRS.map((a) => `**${ATTR_NAME[a].slice(0, 3)}** ${fa[a]} (${fmt(fm[a])})`).join("  ·  "),
      },
      {
        name: "Health / Speed / Defense / Bulk",
        value: `${derived.health}  ·  ${derived.speed} ft  ·  ${derived.defense}  ·  ${derived.bulk}`,
      },
      {
        name: "Saves",
        value: `Fortitude (Con) ${fmt(saves.con)}  ·  Reflex (Dex) ${fmt(saves.dex)}  ·  Will (Wis) ${fmt(saves.wis)}`,
      },
      {
        name: "Feats",
        value: feats.map((af) => `**${formatFeatLabel(af)}**`).join(", ") || "—",
      },
      {
        name: "Flaws",
        value: roles.map((r) => `**${r.name}:** ${r.flaw}`).join("\n"),
      },
      {
        name: "Skills",
        value: SKILLS.map((s) => `${s.name} ${fmt(skills[s.id])}`).join("  ·  "),
      }
    );

  if (kit) {
    embed.addFields({ name: "Kit", value: `**${kit.name}:** ${kit.items.join(", ")}` });
  }
  if (session.customArmor && session.customArmor.length) {
    embed.addFields({
      name: "Armor",
      value: session.customArmor.map((a) => `${a.name} (AC ${fmt(a.acBonus)})`).join(", "),
    });
  }
  if (session.gearText) {
    embed.addFields({ name: "Other Gear", value: session.gearText });
  }
  if (session.grabbed) {
    embed.addFields({ name: "Grabbed without thinking", value: session.grabbed });
  }
  embed.setFooter({ text: "Unofficial fan-made tool for Bubba's Guide to the Zombie Apocalypse." });
  return embed;
}

function skillLabel(id) {
  const s = SKILLS.find((s) => s.id === id);
  return s ? s.name : id;
}

function formatFeatLabel(activeFeat) {
  const feat = FEAT_BY_ID[activeFeat.featId];
  if (!activeFeat.param) return feat.name;
  const paramLabel =
    activeFeat.param === "melee" ? "Melee" : activeFeat.param === "ranged" ? "Ranged" : skillLabel(activeFeat.param);
  return `${feat.name} (${paramLabel})`;
}

function renderFinalSheet(session) {
  const embed = buildSheetEmbed(session);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("sf_save").setLabel("Save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("sf_export").setLabel("Export as file").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sf_share").setLabel("Share to channel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("sf_restart").setLabel("Start over").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [row] };
}

function characterSummaryText(session) {
  const roles = session.roles.map((id) => ROLE_BY_ID[id]);
  const fa = engine.finalAttrs(session);
  const fm = engine.finalMods(session);
  const derived = engine.derivedStats(session);
  const saves = engine.saveTotals(session).totals;
  const skills = engine.skillTotals(session).totals;
  const feats = engine.activeFeats(session);
  const kit = session.kitId && session.kitId !== "none" ? KIT_BY_ID[session.kitId] : null;

  let t = `${session.name || "Unnamed Survivor"}\n${roles.map((r) => r.name).join(" / ")}\n`;
  if (session.background) t += `\n${session.background}\n`;
  t += `\nAttributes: ${ATTRS.map((a) => `${ATTR_NAME[a]} ${fa[a]} (${fmt(fm[a])})`).join(", ")}\n`;
  t += `Health ${derived.health} | Speed ${derived.speed} ft | Defense ${derived.defense} | Bulk Capacity ${derived.bulk}\n`;
  t += `Saves: Fortitude ${fmt(saves.con)}, Reflex ${fmt(saves.dex)}, Will ${fmt(saves.wis)}\n`;
  t += `\nSkills:\n`;
  SKILLS.forEach((s) => (t += `  ${s.name}: ${fmt(skills[s.id])}\n`));
  t += `\nFeats: ${feats.map(formatFeatLabel).join(", ") || "—"}\n`;
  t += `Flaws: ${roles.map((r) => `${r.name}: ${r.flaw}`).join(" / ")}\n`;
  if (kit) t += `\nKit — ${kit.name}: ${kit.items.join(", ")}\n`;
  if (session.customArmor && session.customArmor.length)
    t += `Armor: ${session.customArmor.map((a) => `${a.name} (AC ${fmt(a.acBonus)})`).join(", ")}\n`;
  if (session.gearText) t += `Other gear: ${session.gearText}\n`;
  if (session.grabbed) t += `Grabbed without thinking: ${session.grabbed}\n`;
  return t;
}

/* ---------------- Transitions ---------------- */
function afterRolesChosen(session, chosenIds) {
  session.roles = [chosenIds[0], chosenIds[1]];
  session.pending = buildPendingQueue(session);
  session.step = session.pending.length ? "pending" : "attrs";
  return session.pending.length ? renderPendingStep(session) : renderAttrsIntro(session);
}

function afterAbilityAnswer(session, attr) {
  const prompt = session.pending.shift();
  session.roleAbilityChoice[prompt.roleIdx] = attr;
  return afterPendingAdvance(session);
}

function afterSkillAnswer(session, skillIds) {
  const prompt = session.pending.shift();
  session.roleSkillChoice[prompt.roleIdx] = skillIds;
  return afterPendingAdvance(session);
}

function afterFeatChoiceAnswer(session, featId) {
  const prompt = session.pending.shift();
  session.roleFeatParam[prompt.roleIdx + "_choice"] = featId;
  const feat = FEAT_BY_ID[featId];
  const role = ROLE_BY_ID[session.roles[prompt.roleIdx]];
  if (feat.param && role.featGrant.forceParam === undefined) {
    session.pending.unshift({ type: "featParam", roleIdx: prompt.roleIdx, kind: feat.param, featName: feat.name });
  }
  return afterPendingAdvance(session);
}

function afterFeatParamAnswer(session, value) {
  const prompt = session.pending.shift();
  session.roleFeatParam[prompt.roleIdx] = value;
  return afterPendingAdvance(session);
}

function afterPendingAdvance(session) {
  if (session.pending.length) {
    return renderPendingStep(session);
  }
  session.step = "attrs";
  return renderAttrsIntro(session);
}

module.exports = {
  renderRolesStep,
  renderPendingStep,
  renderAttrsIntro,
  attrsModal,
  parseAttrsInput,
  renderKitStep,
  renderArmorStep,
  ARMOR_FLAT,
  ARMOR_BY_KEY,
  renderGearIntro,
  gearModal,
  renderDetailsIntro,
  detailsModal,
  renderFinalSheet,
  buildSheetEmbed,
  characterSummaryText,
  afterRolesChosen,
  afterAbilityAnswer,
  afterSkillAnswer,
  afterFeatChoiceAnswer,
  afterFeatParamAnswer,
};
