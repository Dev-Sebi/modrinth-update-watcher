import fs from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;

// Modrinth lists versions oldest first, so the newest ids are the tail of the list.
const MAX_REMEMBERED_VERSIONS = 500;

export function emptyState() {
  return { schema: SCHEMA_VERSION, users: {} };
}

export function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) return emptyState();

  const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (parsed.schema !== SCHEMA_VERSION || typeof parsed.users !== "object" || parsed.users === null) {
    return emptyState();
  }
  return parsed;
}

// Written to a temporary file first so a crash mid-write cannot leave a broken state file behind.
export function saveState(stateFile, state) {
  const directory = path.dirname(stateFile);
  fs.mkdirSync(directory, { recursive: true });

  const tempFile = `${stateFile}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tempFile, stateFile);
}

export function deleteState(stateFile) {
  fs.rmSync(stateFile, { force: true });
  fs.rmSync(`${stateFile}.tmp`, { force: true });
}

export function trimVersionIds(versionIds) {
  if (versionIds.length <= MAX_REMEMBERED_VERSIONS) return versionIds;
  return versionIds.slice(versionIds.length - MAX_REMEMBERED_VERSIONS);
}
