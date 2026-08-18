import axios from "axios";
import { config } from "./config.js";

const MAX_RATE_LIMIT_WAIT_SECONDS = 120;

// Created once at module load; a client per request would leak sockets over weeks of uptime.
const api = axios.create({
  baseURL: "https://api.modrinth.com/v2",
  timeout: 15000,
  headers: {
    Authorization: config.apiKey,
    "User-Agent": config.userAgent,
    Accept: "application/json",
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err, endpoint) {
  const status = err.response?.status;
  if (status === undefined) return `Modrinth request to ${endpoint} failed: ${err.message}`;

  const body = err.response?.data;
  const detail = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return `Modrinth request to ${endpoint} failed with HTTP ${status}: ${detail.slice(0, 300)}`;
}

function rateLimitWaitSeconds(err) {
  const reset = Number(err.response?.headers?.["x-ratelimit-reset"]);
  if (!Number.isFinite(reset) || reset < 0) return 10;
  return Math.min(Math.max(reset, 1), MAX_RATE_LIMIT_WAIT_SECONDS);
}

// One retry only, and it loops instead of recursing so a rate limited endpoint cannot grow the stack.
async function get(endpoint, params) {
  let allowRetry = true;
  while (true) {
    try {
      const response = await api.get(endpoint, { params });
      return response.data;
    } catch (err) {
      if (allowRetry && err.response?.status === 429) {
        allowRetry = false;
        await sleep(rateLimitWaitSeconds(err) * 1000);
        continue;
      }
      throw new Error(describeError(err, endpoint));
    }
  }
}

export function getUser(account) {
  return get(`/user/${encodeURIComponent(account)}`);
}

export function getUserProjects(account) {
  return get(`/user/${encodeURIComponent(account)}/projects`);
}

export function getProjectVersions(projectId) {
  return get(`/project/${encodeURIComponent(projectId)}/version`);
}
