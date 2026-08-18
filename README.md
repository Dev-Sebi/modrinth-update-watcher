# Modrinth Watcher

Watches one or more Modrinth accounts and posts an embed to a Discord webhook whenever something happens:

- a new version of any of their projects is released
- a new project is published
- a project passes a download or follower milestone

It is a plain script, not a Discord bot. Modrinth has no webhook or event API, so the watcher polls
(every 15 minutes by default).

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`. Only `AccountLink` and `DiscordWebhook` are required:

| Key | Meaning |
| --- | --- |
| `ApiKey` | Optional. Public profiles need no token, so it can stay empty. Only add one (from <https://modrinth.com/settings/pats>, read scopes) to also see draft, unlisted or private projects. |
| `AccountLink` | Profile link, username or user id. Several accounts can be separated by commas. |
| `DiscordWebhook` | Channel webhook URL (Channel settings → Integrations → Webhooks). |
| `PollMinutes` | Optional, defaults to `15`. |
| `StateFile` | Optional, defaults to `./state.json`. |
| `ContactEmail` | Optional, added to the User-Agent as Modrinth asks for. |

Check the webhook before waiting for a real release:

```bash
node src/index.js --test
```

## Running

```bash
node src/index.js --once     # one check, then exit
node src/index.js --watch    # keep checking on the interval
node src/index.js --reset    # forget what was already posted
```

The first run only posts a short "now watching" embed and records the current state. It never backfills
old releases.

### Docker (recommended for a server)

```bash
docker compose up -d
docker compose logs -f
```

State lives in the `watcher-data` volume, so restarts and rebuilds do not re-announce anything.

```bash
docker compose exec modrinth-watcher cat /data/state.json   # look at what it remembers
docker compose exec modrinth-watcher node src/index.js --test   # check the webhook
docker compose down -v                                      # forget everything and re-baseline
```

### systemd instead of Docker

```bash
cp systemd/modrinth-watcher.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now modrinth-watcher.timer
```

## Notes

- `.env` and `state.json` are gitignored. The token and webhook URL are never written to the log.
- Updates are sent before the state is saved, so a failed webhook is retried on the next cycle instead of
  being lost.
