import { config } from "./config.js";
import { getProjectVersions, getUser, getUserProjects } from "./modrinth.js";
import {
  buildMilestoneEmbed,
  buildProjectEmbed,
  buildVersionEmbed,
  buildVersionSummaryEmbed,
  buildWatchStartEmbed,
  sendEmbeds,
} from "./discord.js";
import { loadState, saveState, trimVersionIds } from "./state.js";
import { reachedDownloadMilestone, reachedFollowerMilestone } from "./milestones.js";

// More new versions than this at once means a backfill or a mass upload, so they get one summary embed.
const MAX_INDIVIDUAL_VERSION_EMBEDS = 5;

function snapshotProject(project) {
  return {
    slug: project.slug ?? project.id,
    title: project.title ?? project.slug ?? project.id,
    versionIds: trimVersionIds(Array.isArray(project.versions) ? [...project.versions] : []),
    downloads: project.downloads ?? 0,
    followers: project.followers ?? 0,
    downloadMilestone: reachedDownloadMilestone(project.downloads ?? 0),
    followerMilestone: reachedFollowerMilestone(project.followers ?? 0),
  };
}

function newVersionIds(project, known) {
  const live = Array.isArray(project.versions) ? project.versions : [];
  const stored = Array.isArray(known.versionIds) ? known.versionIds : [];
  if (stored.length === 0) return live;

  // Modrinth lists versions oldest first, so everything after the newest known id is new.
  // Walking backwards keeps deleted versions from making the whole history look new again.
  for (let index = stored.length - 1; index >= 0; index -= 1) {
    const position = live.lastIndexOf(stored[index]);
    if (position !== -1) return live.slice(position + 1);
  }

  // Nothing known is left, so the history was rebuilt; re-baseline quietly instead of flooding.
  return [];
}

async function collectVersionEmbeds(user, project, newIds) {
  const versions = await getProjectVersions(project.id);
  const wanted = new Set(newIds);
  const fresh = versions
    .filter((version) => wanted.has(version.id))
    .sort((a, b) => new Date(a.date_published) - new Date(b.date_published));

  if (fresh.length === 0) return [];
  if (fresh.length > MAX_INDIVIDUAL_VERSION_EMBEDS) return [buildVersionSummaryEmbed(user, project, fresh)];
  return fresh.map((version) => buildVersionEmbed(user, project, version));
}

function milestoneEmbeds(user, project, known) {
  const embeds = [];

  const downloadMilestone = reachedDownloadMilestone(project.downloads ?? 0);
  if (downloadMilestone > (known.downloadMilestone ?? 0)) {
    embeds.push(buildMilestoneEmbed(user, project, "downloads", downloadMilestone));
  }

  const followerMilestone = reachedFollowerMilestone(project.followers ?? 0);
  if (followerMilestone > (known.followerMilestone ?? 0)) {
    embeds.push(buildMilestoneEmbed(user, project, "followers", followerMilestone));
  }

  return embeds;
}

async function checkAccount(account, state) {
  const user = await getUser(account);
  const projects = await getUserProjects(account);

  const key = user.id;
  const knownUser = state.users[key];
  const embeds = [];

  if (knownUser === undefined) {
    embeds.push(buildWatchStartEmbed(user, projects));
  }

  // Rebuilt from the live list every cycle, so removed projects simply disappear from the state.
  const nextProjects = {};

  for (const project of projects) {
    const known = knownUser?.projects?.[project.id];

    if (knownUser !== undefined) {
      if (known === undefined) {
        embeds.push(buildProjectEmbed(user, project));
      } else {
        const newIds = newVersionIds(project, known);
        if (newIds.length > 0) embeds.push(...(await collectVersionEmbeds(user, project, newIds)));
        embeds.push(...milestoneEmbeds(user, project, known));
      }
    }

    nextProjects[project.id] = snapshotProject(project);
  }

  return {
    embeds,
    userState: { id: user.id, username: user.username, projects: nextProjects },
    summary: `${user.username}: ${projects.length} projects, ${embeds.length} update(s)`,
  };
}

export async function runCycle({ log = console.log } = {}) {
  const state = loadState(config.stateFile);
  const results = [];
  const embeds = [];

  for (const account of config.accounts) {
    const result = await checkAccount(account, state);
    results.push(result);
    embeds.push(...result.embeds);
    log(result.summary);
  }

  // Sending first means a failed webhook leaves the state untouched and the update is retried next cycle.
  if (embeds.length > 0) await sendEmbeds(embeds);

  for (const result of results) {
    state.users[result.userState.id] = result.userState;
  }
  saveState(config.stateFile, state);

  return embeds.length;
}
