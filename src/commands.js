const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags } = require("discord.js");
const sessionStore = require("./session");
const wizard = require("./wizard");
const db = require("./db");

const MAROON = 0x6e1414;

function rollPool() {
  function d6() {
    return 1 + Math.floor(Math.random() * 6);
  }
  const pool = [];
  for (let i = 0; i < 6; i++) {
    const dice = [d6(), d6(), d6(), d6()].sort((a, b) => b - a);
    pool.push(dice[0] + dice[1] + dice[2]);
  }
  pool.sort((a, b) => b - a);
  return pool;
}

const data = new SlashCommandBuilder()
  .setName("survivor")
  .setDescription("Build and manage Survivors for Bubba's Guide to the Zombie Apocalypse")
  .addSubcommand((sub) => sub.setName("build").setDescription("Start building a new Survivor"))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel your in-progress build"))
  .addSubcommand((sub) =>
    sub
      .setName("sheet")
      .setDescription("Show one of your saved Survivors")
      .addStringOption((opt) => opt.setName("name").setDescription("Which Survivor?").setRequired(false).setAutocomplete(true))
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("List your saved Survivors"))
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete one of your saved Survivors")
      .addStringOption((opt) => opt.setName("name").setDescription("Which Survivor?").setRequired(true).setAutocomplete(true))
  )
  .addSubcommand((sub) => sub.setName("roll").setDescription("Roll 4d6-drop-lowest six times (Roll & Arrange method)"));

async function autocomplete(interaction) {
  const focused = interaction.options.getFocused();
  const list = db.listForUser(interaction.user.id);
  const choices = list
    .map((c) => c.savedName)
    .filter((n) => n.toLowerCase().includes((focused || "").toLowerCase()))
    .slice(0, 25);
  await interaction.respond(choices.map((n) => ({ name: n, value: n })));
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "build") {
    if (sessionStore.get(interaction.user.id)) {
      await interaction.reply({
        content: "You've already got a build in progress — use `/survivor cancel` first if you want to start over.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    sessionStore.start(interaction.user.id);
    const { embeds, components } = wizard.renderRolesStep();
    await interaction.reply({ embeds, components, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "cancel") {
    const had = sessionStore.get(interaction.user.id);
    sessionStore.clear(interaction.user.id);
    await interaction.reply({
      content: had ? "Build cancelled." : "You don't have a build in progress.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "roll") {
    const pool = rollPool();
    await interaction.reply({
      content: `🎲 **${pool.join(", ")}**\nAssign these six to Str, Dex, Con, Int, Wis, Cha in whatever order you like, then use those numbers with \`/survivor build\`'s Attributes step.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const list = db.listForUser(interaction.user.id);
    if (!list.length) {
      await interaction.reply({ content: "You don't have any saved Survivors yet.", flags: MessageFlags.Ephemeral });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(MAROON)
      .setTitle("Your Survivors")
      .setDescription(
        list
          .map((c) => {
            const roles = (c.roles || []).map((id) => id).join(" / ");
            return `**${c.savedName}** — ${roles}`;
          })
          .join("\n")
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "sheet") {
    const name = interaction.options.getString("name");
    const list = db.listForUser(interaction.user.id);
    if (!list.length) {
      await interaction.reply({ content: "You don't have any saved Survivors yet.", flags: MessageFlags.Ephemeral });
      return;
    }
    let snapshot;
    if (name) {
      snapshot = db.getForUser(interaction.user.id, name);
      if (!snapshot) {
        await interaction.reply({ content: `No saved Survivor named "${name}".`, flags: MessageFlags.Ephemeral });
        return;
      }
    } else if (list.length === 1) {
      snapshot = list[0];
    } else {
      const select = new StringSelectMenuBuilder()
        .setCustomId("sf_sheet_pick")
        .setPlaceholder("Choose a Survivor…")
        .addOptions(list.slice(0, 25).map((c) => ({ label: c.savedName, value: c.savedName })));
      await interaction.reply({
        content: "Which Survivor?",
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const embed = wizard.buildSheetEmbed(snapshot);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name");
    const removed = db.deleteForUser(interaction.user.id, name);
    await interaction.reply({
      content: removed ? `Deleted "${name}".` : `No saved Survivor named "${name}".`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

module.exports = { data, execute, autocomplete };
