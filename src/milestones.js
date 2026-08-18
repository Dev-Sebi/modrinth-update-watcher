const DOWNLOAD_STEPS = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000];
const FOLLOWER_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function highestReached(value, steps) {
  let reached = 0;
  for (const step of steps) {
    if (value >= step) reached = step;
  }
  return reached;
}

export function reachedDownloadMilestone(downloads) {
  return highestReached(downloads, DOWNLOAD_STEPS);
}

export function reachedFollowerMilestone(followers) {
  return highestReached(followers, FOLLOWER_STEPS);
}
