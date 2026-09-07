/* Registers the /survivor slash command with Discord.
   Run this once after you first deploy, and again any time the command's
   definition changes (new subcommand, new option, etc.) — Discord caches
   command definitions, so just restarting the bot is not enough on its own.

   Set GUILD_ID in your .env to register the command to a single server
   instantly (great for testing). Leave it unset to register it globally,
   which can take up to an hour to show up everywhere but works in every
   server the bot is in. */
require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("./src/commands");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in your environment. Check .env.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    const body = [commands.data.toJSON()];
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`Registered /survivor to guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log("Registered /survivor globally (may take up to an hour to appear everywhere).");
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
    process.exit(1);
  }
})();
