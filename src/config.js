import fs from "node:fs";
import path from "node:path";

const ENV_FILE = path.resolve(process.cwd(), ".env");
const WEBHOOK_PATTERN = /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// "PollMinutes", "POLL_MINUTES" and "pollminutes" should all mean the same setting.
function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    values[normalizeKey(key)] = value;
  }
  return values;
}

function buildSettings() {
  const settings = parseEnvFile(ENV_FILE);
  // Real environment variables win, so `docker compose --env-file` and shell overrides work.
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== "") settings[normalizeKey(key)] = value;
  }
  return settings;
}

function readSetting(settings, name, fallback = "") {
  const value = settings[normalizeKey(name)];
  return value === undefined || value === "" ? fallback : value;
}

// Accepts a profile link, a bare username or a raw user id.
function parseAccount(entry) {
  const trimmed = entry.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  if (!trimmed.includes("/")) return trimmed;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function fail(message) {
  throw new Error(`Configuration error: ${message}`);
}

function loadConfig() {
  const settings = buildSettings();

  const apiKey = readSetting(settings, "ApiKey");
  const accountLink = readSetting(settings, "AccountLink");
  const discordWebhook = readSetting(settings, "DiscordWebhook");

  if (apiKey === "") fail("ApiKey is missing. Copy .env.example to .env and fill it in.");
  if (accountLink === "") fail("AccountLink is missing.");
  if (discordWebhook === "") fail("DiscordWebhook is missing.");
  if (!WEBHOOK_PATTERN.test(discordWebhook)) {
    fail("DiscordWebhook does not look like a Discord webhook URL.");
  }

  const accounts = accountLink.split(",").map(parseAccount).filter((name) => name !== "");
  if (accounts.length === 0) fail("AccountLink did not contain a usable username.");

  const pollMinutes = Number(readSetting(settings, "PollMinutes", "15"));
  if (!Number.isFinite(pollMinutes) || pollMinutes < 1) {
    fail("PollMinutes must be a number of at least 1.");
  }

  const contactEmail = readSetting(settings, "ContactEmail");
  const contact = contactEmail === "" ? "https://github.com/" : contactEmail;

  return {
    apiKey,
    accounts,
    discordWebhook,
    pollMinutes,
    stateFile: path.resolve(process.cwd(), readSetting(settings, "StateFile", "./state.json")),
    userAgent: `modrinth-watcher/1.0 (${contact})`,
  };
}

export const config = loadConfig();

// Secrets must never reach the log, so only the tail is ever printed.
export function redact(secret) {
  if (typeof secret !== "string" || secret.length <= 6) return "***";
  return `***${secret.slice(-6)}`;
}
