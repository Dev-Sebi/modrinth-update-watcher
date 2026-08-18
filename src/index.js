const USAGE = `Modrinth Watcher

  node src/index.js --once     check one time and exit
  node src/index.js --watch    keep checking on the configured interval
  node src/index.js --test     send one sample embed of each kind to the webhook
  node src/index.js --reset    forget what was already posted
`;

let stopRequested = false;
let wakeUp = null;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logError(message) {
  console.error(`[${new Date().toISOString()}] ${message}`);
}

// Resolves early on shutdown so the container stops right away instead of waiting out the interval.
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    wakeUp = finish;

    function finish() {
      clearTimeout(timer);
      wakeUp = null;
      resolve();
    }
  });
}

function requestStop(signal) {
  log(`Received ${signal}, shutting down.`);
  stopRequested = true;
  if (wakeUp) wakeUp();
}

function heapUsedMb() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}

async function runOnce() {
  const { runCycle } = await import("./watch.js");
  const sent = await runCycle({ log });
  log(`Cycle done, ${sent} embed(s) sent, heap ${heapUsedMb()} MB.`);
}

async function runWatch() {
  const { config } = await import("./config.js");
  const { runCycle } = await import("./watch.js");
  const intervalMs = config.pollMinutes * 60 * 1000;

  log(`Watching ${config.accounts.join(", ")} every ${config.pollMinutes} minute(s).`);

  while (!stopRequested) {
    try {
      const sent = await runCycle({ log });
      log(`Cycle done, ${sent} embed(s) sent, heap ${heapUsedMb()} MB.`);
    } catch (err) {
      // A failed cycle must never end the loop; the next run picks the updates up again.
      logError(`Cycle failed: ${err.message}`);
    }
    if (stopRequested) break;
    await sleep(intervalMs);
  }
}

async function runTest() {
  const { buildMilestoneEmbed, buildProjectEmbed, buildVersionEmbed, buildWatchStartEmbed, sendEmbeds } = await import("./discord.js");

  const user = { id: "test", username: "modrinth-watcher-test", avatar_url: "" };
  const project = {
    id: "test-project",
    slug: "sodium",
    title: "Example Project",
    description: "A sample project used to check that the webhook works.",
    project_type: "mod",
    categories: ["optimization", "utility"],
    client_side: "required",
    server_side: "optional",
    downloads: 10000,
    followers: 250,
    icon_url: "",
    gallery: [],
  };
  const version = {
    id: "test-version",
    version_number: "1.2.3",
    version_type: "release",
    changelog: "- Sample changelog line\n- Another change",
    loaders: ["fabric", "quilt"],
    game_versions: ["1.21", "1.21.1"],
    files: [{ primary: true, filename: "example-1.2.3.jar", url: "https://modrinth.com", size: 512000 }],
  };

  await sendEmbeds([
    buildWatchStartEmbed(user, [project]),
    buildProjectEmbed(user, project),
    buildVersionEmbed(user, project, version),
    buildMilestoneEmbed(user, project, "downloads", 10000),
  ]);
  log("Sent 4 sample embeds.");
}

async function runReset() {
  const { config } = await import("./config.js");
  const { deleteState } = await import("./state.js");
  deleteState(config.stateFile);
  log(`Removed ${config.stateFile}. The next run starts fresh.`);
}

async function main() {
  const mode = process.argv[2] ?? "--once";

  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logError(`Uncaught exception: ${err.message}`);
    process.exit(1);
  });

  switch (mode) {
    case "--once":
      await runOnce();
      break;
    case "--watch":
      await runWatch();
      break;
    case "--test":
      await runTest();
      break;
    case "--reset":
      await runReset();
      break;
    case "--help":
    case "-h":
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown option: ${mode}\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
