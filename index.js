require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
} = require("discord.js");
const crypto = require("crypto");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const DB_FILE = "./db.json";

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function generateCode() {
  return `VERIFY-${crypto.randomInt(100000, 999999)}`;
}

// 1) Zamień nick na userId Roblox
async function getRobloxUserId(username) {
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Roblox username lookup failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.data || !data.data.length) return null;

  return {
    id: data.data[0].id,
    username: data.data[0].name,
    displayName: data.data[0].displayName,
  };
}

// 2) Pobierz opis profilu
// UWAGA: tutaj trzeba podpiąć działający endpoint, który naprawdę zwraca bio.
// Ten placeholder pokazuje strukturę, ale sam może nie działać bez twojego źródła danych.
async function getRobloxDescription(userId) {
  // PRZYKŁAD: podmień na własny endpoint / proxy
  // const res = await fetch(`https://twoj-endpoint.example/roblox/${userId}`);
  // const data = await res.json();
  // return data.description || "";

  throw new Error(
    "Brak podpiętego źródła opisu profilu Roblox. Podłącz endpoint, który zwraca bio."
  );
}

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Rozpocznij weryfikację Roblox")
    .addStringOption((option) =>
      option
        .setName("nick")
        .setDescription("Twój nick w Roblox")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("check")
    .setDescription("Sprawdź, czy kod jest w bio profilu Roblox"),

  new SlashCommandBuilder()
    .setName("unverify")
    .setDescription("Usuń swoje powiązanie Roblox"),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("Slash commands registered.");
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const db = loadDb();

  try {
    if (interaction.commandName === "verify") {
      const nick = interaction.options.getString("nick", true);
      const robloxUser = await getRobloxUserId(nick);

      if (!robloxUser) {
        return interaction.reply({
          content: "Nie znalazłem takiego użytkownika Roblox.",
          ephemeral: true,
        });
      }

      const code = generateCode();

      db.users[interaction.user.id] = {
        discordId: interaction.user.id,
        robloxUserId: robloxUser.id,
        robloxUsername: robloxUser.username,
        robloxDisplayName: robloxUser.displayName,
        code,
        verified: false,
        createdAt: new Date().toISOString(),
      };

      saveDb(db);

      return interaction.reply({
        content:
          `Znaleziono konto **${robloxUser.username}**.\n\n` +
          `Wklej ten kod do opisu profilu Roblox:\n` +
          `\`${code}\`\n\n` +
          `Potem użyj komendy **/check**.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === "check") {
      const entry = db.users[interaction.user.id];

      if (!entry) {
        return interaction.reply({
          content: "Najpierw użyj **/verify**.",
          ephemeral: true,
        });
      }

      let description = "";
      try {
        description = await getRobloxDescription(entry.robloxUserId);
      } catch (err) {
        return interaction.reply({
          content:
            "Nie udało się pobrać opisu profilu Roblox. Musisz podpiąć działający endpoint do odczytu bio.",
          ephemeral: true,
        });
      }

      if (!description.includes(entry.code)) {
        return interaction.reply({
          content:
            `Kod nadal nie jest widoczny w bio profilu **${entry.robloxUsername}**.\n` +
            `Szukany kod: \`${entry.code}\``,
          ephemeral: true,
        });
      }

      entry.verified = true;
      entry.verifiedAt = new Date().toISOString();
      saveDb(db);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(VERIFIED_ROLE_ID);

      return interaction.reply({
        content: `Zweryfikowano konto **${entry.robloxUsername}** i nadano rolę.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === "unverify") {
      const entry = db.users[interaction.user.id];

      if (!entry) {
        return interaction.reply({
          content: "Nie masz aktywnego powiązania.",
          ephemeral: true,
        });
      }

      delete db.users[interaction.user.id];
      saveDb(db);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
        await member.roles.remove(VERIFIED_ROLE_ID);
      }

      return interaction.reply({
        content: "Usunięto twoje powiązanie i rolę weryfikacji.",
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) {
      return interaction.reply({
        content: "Wystąpił błąd podczas obsługi komendy.",
        ephemeral: true,
      });
    }
  }
});

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(console.error);