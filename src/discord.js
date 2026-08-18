import axios from "axios";
import { config } from "./config.js";

const COLORS = {
  version: 0x1bd96a,
  project: 0x00afef,
  milestone: 0xffb02e,
  info: 0x8b8b8b,
};

const EMBEDS_PER_MESSAGE = 10;
// Discord counts every embed in a message against one 6000 character budget.
const CHARS_PER_MESSAGE = 5800;
const MAX_RETRIES = 3;

const webhook = axios.create({ timeout: 15000 });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text, limit) {
  const value = String(text ?? "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown";
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function capitalize(text) {
  const value = String(text ?? "");
  return value === "" ? value : value[0].toUpperCase() + value.slice(1);
}

function listOrDash(items, limit = 6) {
  if (!Array.isArray(items) || items.length === 0) return "—";
  const shown = items.slice(0, limit).map(capitalize).join(", ");
  return items.length > limit ? `${shown} +${items.length - limit} more` : shown;
}

function projectUrl(project) {
  return `https://modrinth.com/project/${project.slug ?? project.id}`;
}

function baseEmbed(user, color) {
  return {
    color,
    timestamp: new Date().toISOString(),
    author: {
      name: user.username,
      url: `https://modrinth.com/user/${user.username}`,
      icon_url: user.avatar_url || undefined,
    },
    footer: { text: "Modrinth Watcher" },
  };
}

function primaryFile(version) {
  const files = Array.isArray(version.files) ? version.files : [];
  return files.find((file) => file.primary) ?? files[0];
}

export function buildVersionEmbed(user, project, version) {
  const file = primaryFile(version);
  const pageUrl = `${projectUrl(project)}/version/${version.id}`;

  const parts = [];
  if (version.changelog) parts.push(truncate(version.changelog, 1000));
  if (file?.url) parts.push(`[Download ${file.filename}](${file.url})`);
  else parts.push(`[Open on Modrinth](${pageUrl})`);

  return {
    ...baseEmbed(user, COLORS.version),
    title: truncate(`${project.title} ${version.version_number}`, 256),
    url: pageUrl,
    description: truncate(parts.join("\n\n"), 4096),
    thumbnail: project.icon_url ? { url: project.icon_url } : undefined,
    fields: [
      { name: "Release type", value: capitalize(version.version_type ?? "release"), inline: true },
      { name: "Loaders", value: truncate(listOrDash(version.loaders), 1024), inline: true },
      { name: "Game versions", value: truncate(listOrDash(version.game_versions), 1024), inline: true },
      { name: "File size", value: formatBytes(file?.size), inline: true },
    ],
  };
}

// Used when a project suddenly gains a pile of versions, so the webhook is not flooded.
export function buildVersionSummaryEmbed(user, project, versions) {
  const lines = versions
    .slice(0, 15)
    .map((version) => `• [${version.version_number}](${projectUrl(project)}/version/${version.id}) — ${capitalize(version.version_type ?? "release")}`);
  if (versions.length > lines.length) lines.push(`• …and ${versions.length - lines.length} more`);

  return {
    ...baseEmbed(user, COLORS.version),
    title: truncate(`${project.title} — ${versions.length} new versions`, 256),
    url: projectUrl(project),
    description: truncate(lines.join("\n"), 4096),
    thumbnail: project.icon_url ? { url: project.icon_url } : undefined,
  };
}

export function buildProjectEmbed(user, project) {
  const gallery = Array.isArray(project.gallery) ? project.gallery : [];
  const featured = gallery.find((image) => image.featured) ?? gallery[0];

  return {
    ...baseEmbed(user, COLORS.project),
    title: truncate(`New ${project.project_type ?? "project"}: ${project.title}`, 256),
    url: projectUrl(project),
    description: truncate(project.description, 4096),
    thumbnail: project.icon_url ? { url: project.icon_url } : undefined,
    image: featured?.url ? { url: featured.url } : undefined,
    fields: [
      { name: "Type", value: capitalize(project.project_type ?? "unknown"), inline: true },
      { name: "Categories", value: truncate(listOrDash(project.categories), 1024), inline: true },
      { name: "Sides", value: `Client: ${capitalize(project.client_side ?? "unknown")}\nServer: ${capitalize(project.server_side ?? "unknown")}`, inline: true },
    ],
  };
}

export function buildMilestoneEmbed(user, project, kind, value) {
  const label = kind === "downloads" ? "downloads" : "followers";

  return {
    ...baseEmbed(user, COLORS.milestone),
    title: truncate(`🎉 ${project.title} passed ${formatNumber(value)} ${label}`, 256),
    url: projectUrl(project),
    thumbnail: project.icon_url ? { url: project.icon_url } : undefined,
    fields: [
      { name: "Downloads", value: formatNumber(project.downloads), inline: true },
      { name: "Followers", value: formatNumber(project.followers), inline: true },
    ],
  };
}

export function buildWatchStartEmbed(user, projects) {
  const totalDownloads = projects.reduce((sum, project) => sum + (project.downloads ?? 0), 0);

  return {
    ...baseEmbed(user, COLORS.info),
    title: truncate(`Now watching ${user.username}`, 256),
    url: `https://modrinth.com/user/${user.username}`,
    description: "Future releases, new projects and milestones will show up here.",
    thumbnail: user.avatar_url ? { url: user.avatar_url } : undefined,
    fields: [
      { name: "Projects", value: formatNumber(projects.length), inline: true },
      { name: "Total downloads", value: formatNumber(totalDownloads), inline: true },
    ],
  };
}

function retryAfterMs(err) {
  const fromBody = Number(err.response?.data?.retry_after);
  if (Number.isFinite(fromBody) && fromBody > 0) {
    // Discord reports seconds on webhooks, but has used milliseconds elsewhere.
    return fromBody > 1000 ? fromBody : fromBody * 1000;
  }
  const fromHeader = Number(err.response?.headers?.["retry-after"]);
  return Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader * 1000 : 2000;
}

async function postBatch(embeds) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // wait=true makes Discord report a rejected payload instead of silently accepting it.
      await webhook.post(`${config.discordWebhook}?wait=true`, { embeds });
      return;
    } catch (err) {
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        await sleep(retryAfterMs(err));
        continue;
      }
      const status = err.response?.status;
      const body = err.response?.data;
      const detail = typeof body === "string" ? body : JSON.stringify(body ?? {});
      throw new Error(`Discord webhook failed${status ? ` with HTTP ${status}` : ""}: ${status ? detail.slice(0, 300) : err.message}`);
    }
  }
}

function embedLength(embed) {
  const fields = embed.fields ?? [];
  const fieldChars = fields.reduce((sum, field) => sum + field.name.length + String(field.value).length, 0);
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0) + fieldChars;
}

function chunkEmbeds(embeds) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const size = embedLength(embed);
    if (current.length > 0 && (current.length >= EMBEDS_PER_MESSAGE || currentChars + size > CHARS_PER_MESSAGE)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(embed);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function sendEmbeds(embeds) {
  const batches = chunkEmbeds(embeds);
  for (let index = 0; index < batches.length; index += 1) {
    await postBatch(batches[index]);
    if (index + 1 < batches.length) await sleep(1000);
  }
}
