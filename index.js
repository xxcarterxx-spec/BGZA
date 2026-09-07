require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits, MessageFlags, AttachmentBuilder } = require("discord.js");

const commands = require("./src/commands");
const sessionStore = require("./src/session");
const wizard = require("./src/wizard");
const db = require("./src/db");

/* -------------------------------------------------------------------------
   Tiny keep-alive web server.
   Render's free plan only offers "Web Service" (not a always-on Background
   Worker), and a Web Service with no HTTP traffic spins down after a period
   of inactivity. Binding to $PORT and answering health checks lets Render
   see the service as a normal web service; pairing this with a free
   external uptime pinger (see the README) hitting this URL every ~10
   minutes is what actually keeps the bot connected around the clock on the
   free tier. None of this is needed on a paid plan that doesn't sleep.
   ------------------------------------------------------------------------- */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Survivor Forge bot is running."));
app.listen(PORT, () => console.log(`[web] keep-alive server listening on ${PORT}`));

/* -------------------------------------------------------------------------
   Discord client
   ------------------------------------------------------------------------- */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// discord.js renamed the "ready" event to "clientReady" in newer v14 releases
// (the old name still fires but is deprecated) — listen for whichever this
// installed version emits so startup logging works either way.
let announced = false;
function announceReady() {
  if (announced) return;
  announced = true;
  console.log(`[bot] logged in as ${client.user.tag}`);
}
client.once("clientReady", announceReady);
client.once("ready", announceReady);

function ownsSessionOrNull(interaction) {
  const session = sessionStore.get(interaction.user.id);
  return session;
}

async function replyExpired(interaction) {
  await interaction.reply({
    content: "This build session has expired (or the bot restarted). Run `/survivor build` to start again.",
    flags: MessageFlags.Ephemeral,
  });
}

client.on("interactionCreate", async (interaction) => {
  try {
    /* ---- slash commands ---- */
    if (interaction.isChatInputCommand()) {
      await commands.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      await commands.autocomplete(interaction);
      return;
    }

    /* ---- saved-sheet disambiguation select (not part of the build wizard) ---- */
    if (interaction.isStringSelectMenu() && interaction.customId === "sf_sheet_pick") {
      const snapshot = db.getForUser(interaction.user.id, interaction.values[0]);
      if (!snapshot) {
        await interaction.update({ content: "That Survivor is gone now.", components: [] });
        return;
      }
      const embed = wizard.buildSheetEmbed(snapshot);
      await interaction.update({ content: null, embeds: [embed], components: [] });
      return;
    }

    /* ---- everything below belongs to an in-progress /survivor build ---- */
    const wizardCustomIds = new Set([
      "sf_roles",
      "sf_cancel",
      "sf_ability",
      "sf_skill",
      "sf_featchoice",
      "sf_featparam",
      "sf_attrs_open",
      "sf_attrs_modal",
      "sf_kit",
      "sf_armor",
      "sf_armor_skip",
      "sf_gear_open",
      "sf_gear_modal",
      "sf_gear_skip",
      "sf_details_open",
      "sf_details_modal",
      "sf_save",
      "sf_export",
      "sf_share",
      "sf_restart",
    ]);
    const isWizardInteraction =
      (interaction.isStringSelectMenu() || interaction.isButton() || interaction.isModalSubmit()) &&
      wizardCustomIds.has(interaction.customId);
    if (!isWizardInteraction) return;

    if (interaction.customId === "sf_cancel") {
      sessionStore.clear(interaction.user.id);
      await interaction.update({ content: "Build cancelled.", embeds: [], components: [] });
      return;
    }

    const session = ownsSessionOrNull(interaction);
    if (!session) {
      await replyExpired(interaction);
      return;
    }

    // Buttons that open a modal (must be the sole response to that interaction)
    if (interaction.customId === "sf_attrs_open") {
      await interaction.showModal(wizard.attrsModal());
      return;
    }
    if (interaction.customId === "sf_gear_open") {
      await interaction.showModal(wizard.gearModal());
      return;
    }
    if (interaction.customId === "sf_details_open") {
      await interaction.showModal(wizard.detailsModal());
      return;
    }

    // Role selection
    if (interaction.customId === "sf_roles") {
      const { embeds, components } = wizard.afterRolesChosen(session, interaction.values);
      await interaction.update({ embeds, components });
      return;
    }

    // Follow-up prompts
    if (interaction.customId === "sf_ability") {
      const { embeds, components } = wizard.afterAbilityAnswer(session, interaction.values[0]);
      await interaction.update({ embeds, components });
      return;
    }
    if (interaction.customId === "sf_skill") {
      const { embeds, components } = wizard.afterSkillAnswer(session, interaction.values);
      await interaction.update({ embeds, components });
      return;
    }
    if (interaction.customId === "sf_featchoice") {
      const { embeds, components } = wizard.afterFeatChoiceAnswer(session, interaction.values[0]);
      await interaction.update({ embeds, components });
      return;
    }
    if (interaction.customId === "sf_featparam") {
      const { embeds, components } = wizard.afterFeatParamAnswer(session, interaction.values[0]);
      await interaction.update({ embeds, components });
      return;
    }

    // Attributes modal submit
    if (interaction.customId === "sf_attrs_modal") {
      const raw = interaction.fields.getTextInputValue("scores");
      const parsed = wizard.parseAttrsInput(raw);
      if (parsed.error) {
        await interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
        return;
      }
      session.baseAttrs = parsed.baseAttrs;
      session.step = "kit";
      const { embeds, components } = wizard.renderKitStep();
      await interaction.update({ embeds, components });
      return;
    }

    // Kit selection
    if (interaction.customId === "sf_kit") {
      session.kitId = interaction.values[0];
      session.step = "armor";
      const { embeds, components } = wizard.renderArmorStep();
      await interaction.update({ embeds, components });
      return;
    }

    // Armor selection / skip
    if (interaction.customId === "sf_armor" || interaction.customId === "sf_armor_skip") {
      if (interaction.customId === "sf_armor") {
        session.customArmor = interaction.values.map((key) => wizard.ARMOR_BY_KEY[key]).filter(Boolean);
      } else {
        session.customArmor = [];
      }
      session.step = "gear";
      const { embeds, components } = wizard.renderGearIntro();
      await interaction.update({ embeds, components });
      return;
    }

    // Gear notes modal submit / skip
    if (interaction.customId === "sf_gear_modal") {
      session.gearText = interaction.fields.getTextInputValue("gear") || "";
      session.step = "details";
      const { embeds, components } = wizard.renderDetailsIntro();
      await interaction.update({ embeds, components });
      return;
    }
    if (interaction.customId === "sf_gear_skip") {
      session.step = "details";
      const { embeds, components } = wizard.renderDetailsIntro();
      await interaction.update({ embeds, components });
      return;
    }

    // Final details modal submit -> compute + show the finished sheet
    if (interaction.customId === "sf_details_modal") {
      session.name = interaction.fields.getTextInputValue("name") || "Unnamed Survivor";
      session.background = interaction.fields.getTextInputValue("background") || "";
      session.grabbed = interaction.fields.getTextInputValue("grabbed") || "";
      session.step = "sheet";
      const { embeds, components } = wizard.renderFinalSheet(session);
      await interaction.update({ embeds, components });
      return;
    }

    // Final-sheet actions
    if (interaction.customId === "sf_save") {
      const snapshot = { ...session, savedName: session.name || "Unnamed Survivor", savedAt: Date.now() };
      db.saveForUser(interaction.user.id, snapshot);
      await interaction.reply({ content: `Saved "${snapshot.savedName}". Look it up later with \`/survivor sheet\`.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.customId === "sf_export") {
      const text = wizard.characterSummaryText(session);
      const filename = (session.name || "survivor").replace(/[^a-z0-9]+/gi, "_") + ".txt";
      const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: filename });
      await interaction.reply({ files: [attachment], flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.customId === "sf_share") {
      const embed = wizard.buildSheetEmbed(session);
      await interaction.channel.send({ embeds: [embed] });
      await interaction.reply({ content: "Posted to the channel.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.customId === "sf_restart") {
      sessionStore.clear(interaction.user.id);
      sessionStore.start(interaction.user.id);
      const { embeds, components } = wizard.renderRolesStep();
      await interaction.update({ embeds, components });
      return;
    }
  } catch (err) {
    console.error("[interaction] error:", err);
    const payload = { content: "Something went wrong handling that — please try again.", flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (_) {
      /* interaction is probably no longer valid (expired token); nothing more we can do */
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
