# Zorofin companion

Status: **early (v0.1.0)**. Modules shipping: `notifications`, `liveTvGuide`, `liveTvStreams`, `recommendations`, `webUi`.

License: AGPL-3.0-only (see [LICENSE](LICENSE)); bundled third-party files are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). "Zorofin" and the
Zorofin logo are not covered by the code license; see
[TRADEMARKS.md](TRADEMARKS.md). To help, read [CONTRIBUTING.md](CONTRIBUTING.md);
to report a vulnerability, read [SECURITY.md](SECURITY.md). The companion is
built largely with AI coding assistants, reviewed and tested by its maintainer.

The companion is the optional half of Zorofin's server backend. The
[Zorofin Jellyfin plugin](https://github.com/Zoraz01/jellyfin-plugin-zorofin) handles everything that
must run inside Jellyfin. The companion runs as its own container and will carry
the modules that benefit from isolation:

| Module | Status | Replaces |
| --- | --- | --- |
| `notifications` | **Available** | A separate request-alert service |
| `liveTvGuide` | **Available** | Hand-run guide enrichment scripts |
| Channel logos | **Available** inside `liveTvGuide` | tv-logos matching plus your own "use this logo" rules |
| `liveTvStreams` | **Available** | Telling viewers by hand which channel is using the Live TV stream |
| `recommendations` | **Available** (deterministic ranking; optional AI ranking with your own key) | Hand-made Home shelves |
| `webUi` | **Available**; ships the Zorofin theme, Live TV pages, Requests hub (off by default) and web player | JavaScript Injector and custom CSS |
| `recap` | Later | — |


**Setting up a server?** Start with
[the setup guide](https://github.com/Zoraz01/jellyfin-plugin-zorofin/blob/main/docs/SETUP.md)
in the plugin repository. It covers the plugin and the companion together:
installing, every Dashboard tab, how they connect, replacing other Jellyfin
plugins, and troubleshooting. This README is the technical reference.

A Zorofin server works without the companion. Apps only see a companion module
when the plugin's capability manifest lists it.

## How it connects

```
Zorofin app ──Jellyfin session──▶ Jellyfin + Zorofin plugin ──signed bridge──▶ companion
Seerr ──webhook (Bearer secret)──────────────────────────────────────────────▶ companion
```

- Apps never talk to the companion directly. They call
  `/Zorofin/Companion/{module}/...` on their Jellyfin server; the plugin checks
  the Jellyfin session and forwards the request with the viewer's id, signed
  with a shared secret. The viewer's Jellyfin token is never forwarded.
- The bridge contract is public and versioned:
  [COMPANION_BRIDGE.md](https://github.com/Zoraz01/jellyfin-plugin-zorofin/blob/main/docs/COMPANION_BRIDGE.md) in the plugin repository.
  It is the only thing the two programs share. Do not copy plugin (GPL) code
  here or companion code into the plugin.
- Seerr webhooks go straight to the companion at `POST /v1/hooks/seerr`.

## Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness; returns status, service and version only |
| `GET /v1/capabilities` | bridge, no viewer | Features merged into the plugin's manifest |
| `GET/POST /v1/modules/{module}/{path}` | bridge, viewer required | Module routes; JSON bodies up to 64 KB |
| `POST /v1/hooks/seerr` | `Authorization: Bearer <webhook secret>` | Seerr events; 404 unless a module listens |
| `GET /v1/public/{module}/{path}` | Checked by the module (e.g. a token in the path) | Files Jellyfin itself reads, such as the guide |
| `GET /v1/admin/settings` | bridge, Jellyfin administrator | Every settings section, secrets shown only as set or not set |
| `POST /v1/admin/settings/{section}` | bridge, Jellyfin administrator | Save one section; applied at once, refused (422) if a module that is on can't start |
| `POST /v1/admin/settings/{section}/test` | bridge, Jellyfin administrator | Check a section's settings and addresses without saving |

## Configuration

**From the Jellyfin Dashboard (recommended):** Dashboard → Plugins → Zorofin →
**Companion settings** lists Connections and every module, each with an on/off
switch, its settings, a **Test** button and **Save**. Changes apply right away
without a restart. Saved values are kept in `<data>/settings.json` (mode 600)
and take the place of the matching environment variables below, which stay as
defaults. Keys are write-only: the page only shows whether one is saved. The
option lists are in [src/settings/schemas.js](src/settings/schemas.js).
The bridge secret, Seerr webhook secret, address, port and data folder can only
be set on the container.

**From environment variables:** every setting can also be set on the
container. Any secret can instead be read from a
file named by `<NAME>_FILE` (Docker secrets).

| Variable | Default | Notes |
| --- | --- | --- |
| `ZOROFIN_BRIDGE_SECRET` | required | At least 32 characters. The same value goes in the plugin's settings |
| `ZOROFIN_SEERR_WEBHOOK_SECRET` | empty | At least 32 characters when set; enables the Seerr webhook |
| `ZOROFIN_JELLYFIN_URL` | empty | How the companion reaches Jellyfin (for modules that read the library) |
| `ZOROFIN_JELLYFIN_API_KEY` | empty | A Jellyfin API key for the companion's own read-only calls |
| `ZOROFIN_MODULES` | empty | Comma-separated module ids to enable |
| `ZOROFIN_COMPANION_BIND` | `127.0.0.1` (`0.0.0.0` in the image) | Listen address |
| `ZOROFIN_COMPANION_PORT` | `9310` | Listen port |
| `ZOROFIN_DATA_DIR` | `./data` (`/data` in the image) | Module state |

The process exits with code 78 on a core configuration error (bridge secret,
port, Jellyfin address) or an unknown module id. A module whose own settings
are incomplete stays off instead, and the Dashboard shows why.

Generate a secret with `openssl rand -hex 32`.

## Develop and test

```sh
npm test                      # node:test, no dependencies
ZOROFIN_BRIDGE_SECRET=$(openssl rand -hex 32) npm start
tools/publish-image.sh --local  # docker build, tagged zorofin-companion:dev
tools/smoke-test-image.sh
```

### Memory

The companion idles at about 50 MB. Its biggest moment is liveTvSource
reading a large provider guide, so that path streams: the download is
scanned in pieces, only the programmes for kept channels are held (as their
own copies, not views into the download), the finished guide is written to
disk in batches, and Jellyfin's reads of `guide.xml` stream from disk. The
image also sets `NODE_OPTIONS=--max-semi-space-size=2`, which trades ~15%
more CPU during a guide refresh for a smaller young generation; set
`NODE_OPTIONS` yourself to change it.

To measure on your machine (a synthetic ~200 MB guide, nothing leaves it):

```sh
node --expose-gc tools/memory-bench.js                # channels hoursPerChannel keepEvery
node --expose-gc --max-semi-space-size=2 tools/memory-bench.js
```

To hard-cap it, give the container a limit (`mem_limit: 512m` in Compose or
`docker run --memory 512m`). Keep it well above the peak the bench reports
for your guide size.

## Run with Docker Compose

`compose.yaml` in this folder is a drop-in service. It has no paths or names
from any particular install, and runs on Linux, NAS boxes and macOS (Docker
Desktop).

**Add it to a stack you already run** (for example a YAMS install):

```yaml
# in your docker-compose.yaml (Compose 2.20 or later)
include:
  - path/to/zorofin-companion/compose.yaml
```

or `docker compose -f docker-compose.yaml -f path/to/zorofin-companion/compose.yaml up -d`.
It joins your existing network and finds services by their usual names.

**Or start from a Zorofin stack**, which includes the same file next to
Jellyfin, Seerr and the rest.

Steps:

1. `tools/new-secrets.sh` creates `secrets/` with a bridge secret and a
   Seerr webhook secret. Add `jellyfin-api-key` and `seerr-api-key` files
   there if your modules need them.
2. `cp companion.env.example companion.env` and fill in the modules you use.
3. Set the variables below in your stack's `.env` if the defaults don't fit.
4. `docker compose up -d zorofin-companion`.
5. In Jellyfin, Dashboard → Plugins → Zorofin: set **Companion URL** and
   **Companion secret** (the bridge secret).

| Variable | Default | Change it when |
| --- | --- | --- |
| `ZOROFIN_NETWORK` | `yams_network` | Your services are on another Docker network |
| `ZOROFIN_JELLYFIN_URL` | `http://jellyfin:8096` | Jellyfin runs on the host (`http://host.docker.internal:8096`) or elsewhere |
| `ZOROFIN_SEERR_URL` | `http://seerr:5055` | Seerr has another name, such as `http://jellyseerr:5055` |
| `ZOROFIN_MODULES` | `notifications` | You want other modules |
| `ZOROFIN_COMPANION_IMAGE` | `zorofin-companion:compose` (built from this folder) | You use the published image (below) |
| `ZOROFIN_COMPANION_PULL` | `missing` | Set `always` with a published image so Compose pulls updates instead of building |
| `ZOROFIN_COMPANION_DATA` | a named volume | You want the data in a folder |
| `ZOROFIN_COMPANION_SECRETS` | `./secrets` | Your secrets live elsewhere |
| `ZOROFIN_COMPANION_PUBLISH` | `127.0.0.1:9310` | Only with `compose.host-jellyfin.yaml`; never expose it to the internet |

### Published image

The companion is published for `linux/amd64` and `linux/arm64` (Intel and
Apple Silicon Macs, most NAS boxes, Raspberry Pi 4/5) as
`ghcr.io/zoraz01/zorofin-companion`:

| Tag | What it is |
| --- | --- |
| `1.2.3`, `1.2` | A release (`companion-v1.2.3` git tag) |
| `latest` | The newest release |
| `edge` | The newest build of `main`; for testing |
| `sha-<commit>` | One exact build |

To use it, set these in the stack's `.env` and run `docker compose up -d
zorofin-companion`:

```sh
ZOROFIN_COMPANION_IMAGE=ghcr.io/zoraz01/zorofin-companion:latest
ZOROFIN_COMPANION_PULL=always
```

Pin a version (`:0.2.0`) on servers you don't want updated by surprise, and
roll back by setting the previous version. The package is public (owner
decision, November 6, 2026), so no login is needed to pull. The image's
source label points at the public Zoraz01/zorofin-companion repository, but a
package first published from this private repository starts private: after
the first publish, set it to Public once in GitHub → Packages → zorofin-companion → Package
settings → Change visibility. The image holds the companion's source as
readable JavaScript.

**Publishing.** `.github/workflows/companion-image.yml` runs the tests, then
pushes `edge` and `sha-…` on every change to `main`, and the release tags when
a `companion-v<version>` tag is pushed (the tag must match `package.json`).
Pull requests get the tests, an amd64 build and `tools/smoke-test-image.sh`,
with nothing pushed. When Actions can't run, publish by hand from a machine
with Docker and `docker login ghcr.io` (token with `write:packages`):

```sh
tools/publish-image.sh --local     # build for this machine and load it
tools/smoke-test-image.sh          # /health, non-root, clean stop
tools/publish-image.sh             # push edge + sha-<commit> for amd64 and arm64
tools/publish-image.sh --release   # also push <version> and latest
```

A release: bump `version` in `package.json`, merge, tag `companion-v<version>`
on that commit and push the tag (or run `tools/publish-image.sh --release`).

**Companion URL for the plugin:** `http://zorofin-companion:9310` when
Jellyfin is a container on the same network. When Jellyfin runs on the host,
also add `compose.host-jellyfin.yaml` (it publishes the port on loopback) and
use `http://localhost:9310`.

Stopping the companion leaves Jellyfin working as plain Jellyfin: the plugin
switches the Zorofin features off.

## Module: notifications

Tells a viewer when a title they requested is ready. Seerr sends
`MEDIA_AVAILABLE`, the companion checks that the title is visible to that
viewer in Jellyfin, then sends email and/or push. Undelivered alerts are retried
every minute for 6 hours, and each channel is retried separately. Delivery
records are kept 30 days.

Channels use the operator's own accounts (guided setup asks for them):

| Variable | Notes |
| --- | --- |
| `ZOROFIN_NOTIFY_EMAIL_API_KEY`, `ZOROFIN_NOTIFY_EMAIL_FROM` | Resend API key and sender. Both or neither |
| `ZOROFIN_NOTIFY_EMAIL_REPLY_TO`, `ZOROFIN_NOTIFY_EMAIL_LOGO` | Optional reply-to and PNG logo path |
| `ZOROFIN_NOTIFY_EMAIL_API_URL` | Default `https://api.resend.com` |
| `ZOROFIN_NOTIFY_NTFY_URL`, `ZOROFIN_NOTIFY_NTFY_TOKEN` | ntfy server the companion publishes to, and its token |
| `ZOROFIN_NOTIFY_NTFY_PUBLIC_URL` | ntfy address viewers subscribe to, if different |
| `ZOROFIN_NOTIFY_NTFY_ADMIN_TOKEN` | Optional ntfy admin token. Each viewer then gets a private read-only ntfy login for their topic |
| `ZOROFIN_SERVER_NAME`, `ZOROFIN_APP_URL` | Name and link shown in alerts |

It also needs `ZOROFIN_JELLYFIN_URL`, `ZOROFIN_JELLYFIN_API_KEY` and
`ZOROFIN_SEERR_WEBHOOK_SECRET`. In Seerr, add a webhook for **Request
Available** to `http://<companion>:9310/v1/hooks/seerr` with
`Authorization: Bearer <webhook secret>` and a JSON payload that includes
`notification_type`, `request_id`, `requestedBy_jellyfinUserId`, `subject`,
`media_status`, `media_type`, `media_jellyfinMediaId`, `media_tmdbid` and
`media_tvdbid`. Do not include email fields.

App routes, through the plugin at `/Zorofin/Companion/notifications/...`:

| Route | Purpose |
| --- | --- |
| `GET preferences` | Available channels and this viewer's settings |
| `POST preferences` | `{ "emailEnabled": bool, "ntfyEnabled": bool }` |
| `POST preferences/email` | `{ "address": "..." }` sends a 6-digit code (3 per hour) |
| `POST preferences/email/confirm` | `{ "code": "123456" }`; 5 tries per code, 30-minute expiry |
| `POST preferences/email/remove` | Removes the address |
| `POST preferences/push/reset-password` | New password for the viewer's private ntfy login |
| `POST preferences/test` | `{ "channel": "email" \| "ntfy" }`; 3 per hour |
| `GET status` | Admins only: counts, no addresses |

Turning push on returns `ntfyPassword` once when private logins are enabled;
turning it off deletes the login, and the next opt-in gets a new topic.

An email address is never taken from Seerr. It is used only after the viewer
confirms a code sent to it. Turning off every channel also deletes that
viewer's delivery history.

## Module: liveTvSource

Builds the channel list and guide Jellyfin (or Threadfin) reads, from an IPTV
source the operator is entitled to use. No provider names or presets ship
with it.

- **Source:** an Xtream login (only the live catalogue is read through
  `player_api.php`, never the VOD lists that make some `get.php` playlists
  hundreds of MB) or any M3U address, read line by line so a huge playlist
  never sits in memory. Gzipped files and redirects work.
- **Groups to keep:** group names or how they start (`US|`, `UK| SPORTS`).
  Empty keeps everything, up to **Most channels** (default 3000). Divider rows
  (`#####`) are dropped.
- **Event channel groups:** pay-per-view or per-game slots appear only while
  something is on. The default rule shows a slot when its name has
  yesterday's, today's or tomorrow's date (`Nov 6`, `06/11`, `2026-11-06`, ...)
  or says Live/Now, and hides "No event", "Ended" and "Coming soon" slots. The
  operator can switch to their own pattern, or show every slot.
- **Guides in priority order:** the provider's own guide (`xmltv.php`), then
  each backup XMLTV address. A channel the first guide leaves empty (no current
  or upcoming listing) takes its listings from the next. Backup guides are
  matched by guide id, then by channel name ("US| ESPN HD" matches "ESPN").
  Each guide's last good copy is kept, so a provider guide outage
  leaves the other guides and the old listings in place.
- **Gaps:** optionally asks an Xtream provider per channel (`get_short_epg`,
  up to 150 channels a refresh, cached 3 hours), then titles event slots that
  still have nothing with the matchup in their name ("Bills vs Rams") for the
  day.
- **Fails open:** if the source can't be read or returns no channels, the
  previous playlist and guide keep being served.

| Variable | Notes |
| --- | --- |
| `ZOROFIN_LIVE_SOURCE_TYPE` | `xtream` (default) or `m3u` |
| `ZOROFIN_LIVE_SOURCE_XTREAM_URL`, `_USERNAME`, `_PASSWORD` | The Xtream login (password may be a `_FILE`) |
| `ZOROFIN_LIVE_SOURCE_STREAM_FORMAT` | `ts` (default, `/live/user/pass/id.ts`), `m3u8`, or `short` (`/user/pass/id`) |
| `ZOROFIN_LIVE_SOURCE_M3U_URL` | Playlist address (secret; it usually holds a login) |
| `ZOROFIN_LIVE_SOURCE_GROUPS` | Comma-separated group names or prefixes to keep |
| `ZOROFIN_LIVE_SOURCE_EVENT_GROUPS` | Comma-separated event-slot groups |
| `ZOROFIN_LIVE_SOURCE_EVENT_RULE` | `today` (default), `pattern` or `all` |
| `ZOROFIN_LIVE_SOURCE_EVENT_PATTERN` | Regular expression for `pattern` |
| `ZOROFIN_LIVE_SOURCE_MAX_CHANNELS` | Default 3000 |
| `ZOROFIN_LIVE_SOURCE_PROVIDER_GUIDE` | `0` to skip the Xtream provider's guide |
| `ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES` | Comma-separated XMLTV addresses, in order of preference |
| `ZOROFIN_LIVE_SOURCE_SHORT_GUIDE` | `1` to ask an Xtream provider per channel for missing listings |
| `ZOROFIN_LIVE_SOURCE_MATCHUPS` | `0` to leave event slots without listings |
| `ZOROFIN_LIVE_SOURCE_TOKEN` | Required. 32+ letters/digits; part of both addresses |
| `ZOROFIN_LIVE_SOURCE_REFRESH_MINUTES` | Channel list, default 60 |
| `ZOROFIN_LIVE_SOURCE_GUIDE_HOURS` | Guide downloads, default 6 |

In Jellyfin (or Threadfin), use:
- tuner (M3U): `http://zorofin-companion:9310/v1/public/liveTvSource/<token>/channels.m3u`
- guide (XMLTV): `http://zorofin-companion:9310/v1/public/liveTvSource/<token>/guide.xml`

The playlist holds the provider's stream addresses (with the login, like any
Xtream M3U), so keep the token private and never publish the companion port.
To add artwork, logos and matchup titles on top, point `liveTvGuide`'s guide
source at the `guide.xml` address above and give Jellyfin `liveTvGuide`'s
address instead. The simultaneous-stream limit is the separate
`liveTvStreams` module.

Admins (through `/Zorofin/Companion/liveTvSource/...`): `GET status` (channel
and event counts, how each channel got its listings, each guide's last
success or error), `GET groups` (every group in the source with its channel
count, to pick from), `GET preview` (sample channels and the event slots that
are on, with their matchups) and `POST refresh`.

## Module: liveTvGuide

Serves the operator's XMLTV guide back to Jellyfin, improved:
- sports listings get the matchup in the title ("NBA Basketball — Bulls vs
  Lakers") when the description names the teams;
- programmes without artwork get a show poster (TVmaze) or a matchup card
  (TheSportsDB), copied to the companion so Jellyfin never depends on those
  sites staying up;
- channels without a logo get one from the public
  [tv-logos](https://github.com/tv-logo/tv-logos) collection for the countries
  the operator picks. Logos are broadcasters' trademarks; the operator's server
  fetches them for its own guide and Zorofin ships none. When a channel gets
  no logo or the wrong one, a "use this logo" rule fixes it (see
  `ZOROFIN_GUIDE_LOGO_OVERRIDES`); a rule also replaces a logo the guide
  already had.

Works with any XMLTV source: Threadfin, xTeVe, a tuner's guide or a listings
service. If the source breaks, Jellyfin keeps getting the last good guide.
Event-channel gating and backup guides live in `liveTvSource`; a server's own
pinned channel numbers belong in a private module.

| Variable | Notes |
| --- | --- |
| `ZOROFIN_GUIDE_SOURCE_URL` | Required. The XMLTV address your tuner or guide tool publishes |
| `ZOROFIN_GUIDE_TOKEN` | Required. 32+ letters/digits; part of the URL Jellyfin reads |
| `ZOROFIN_GUIDE_PUBLIC_URL` | How Jellyfin reaches the companion, e.g. `http://zorofin-companion:9310`. Needed for artwork |
| `ZOROFIN_GUIDE_TVMAZE` | `1` to look up show posters on TVmaze (CC BY-SA; operator opts in) |
| `ZOROFIN_GUIDE_SPORTSDB_KEY` | The operator's own TheSportsDB key, for matchup cards |
| `ZOROFIN_GUIDE_CHANNEL_LOGOS` | `1` to add channel logos from tv-logos |
| `ZOROFIN_GUIDE_LOGO_COUNTRIES` | tv-logos country folders, default `united-states` (e.g. `united-states,united-kingdom`) |
| `ZOROFIN_GUIDE_LOGO_OVERRIDES` | Comma-separated `Channel name=logo` rules. The logo is a tv-logos file name from any country (`nbc-4-washington-us.png`), an `https://` image, or `none`. A rule matches the channel name with or without a provider prefix like `US|`, and the longest matching name wins |
| `ZOROFIN_GUIDE_MATCHUP_TITLES` | `0` to leave titles unchanged |
| `ZOROFIN_GUIDE_REFRESH_MINUTES` | Default 30 |

Lookups are cached and rate-limited (TVmaze 60 new shows per refresh,
TheSportsDB 6 new matchups per refresh, spaced for its free tier; the tv-logos
file list is fetched at most weekly). Without
either source the module only adds matchup titles and makes no outside calls.

In Jellyfin: **Dashboard → Live TV → TV Guide Data Providers → XMLTV**, file
or URL `http://zorofin-companion:9310/v1/public/liveTvGuide/<token>/guide.xml`,
replacing the direct guide URL. Admins can check `GET status` or trigger
`POST refresh` at `/Zorofin/Companion/liveTvGuide/...`.

## Module: liveTvStreams

Tells apps how many Live TV streams the provider allows, how many are in use
and which channel each one is playing, so a client can show "1 of 1 Live TV
stream in use: ESPN" and offer **Join** instead of a start that fails.

In-use streams come from Jellyfin's sessions: one stream per distinct live
channel, because Threadfin and Jellyfin share one upstream connection between
everyone watching the same channel. A session counts only while its player has
checked in recently, since Jellyfin can keep a closed player's channel listed.
The limit is the operator's setting, or, with the provider's Xtream login, the
provider's own `max_connections`. The provider's `active_cons` also reveals
streams used outside this server (another app on the account, or a relay that
hasn't closed yet). The check is advisory and reserves nothing.

`GET /Zorofin/Companion/liveTvStreams/status`, optionally with `channelId`
and the viewer's `deviceId`, for any viewer with Live TV access:

```json
{
  "version": 1, "state": "full", "limit": 1, "inUse": 1, "free": 0, "otherUse": 0,
  "message": "1 of 1 Live TV stream in use: ESPN.",
  "streams": [{ "channelId": "…", "channelName": "ESPN", "channelNumber": "206",
    "programme": { "title": "Monday Night Football", "endsAt": "…" },
    "startedAt": "…", "viewers": 2, "paused": false, "yours": true }],
  "request": { "channelId": "…", "playing": false, "canStart": false, "reason": "full",
    "message": "The Live TV stream is in use on another channel. You can join that channel, or try again when it is free." }
}
```

`request.reason` is `join` (already playing), `free`, `switch` (this device
holds the only stream it would replace) or `full`. Viewers never see other
people's names. Administrators also get `watching` per stream (name, device,
paused) unless turned off, `limitSource`, the provider's numbers and
`warnings` (setting above the provider's limit, account not active, account
ending within 14 days). Provider passwords are never returned or logged.
Jellyfin failures return `503` with `state: "unknown"`; clients should then
play normally.

| Variable | Meaning |
| --- | --- |
| `ZOROFIN_STREAMS_LIMIT` | Streams the provider allows, 1–50, default 1. Match Threadfin's tuner count |
| `ZOROFIN_STREAMS_XTREAM_URL` | Optional provider address, e.g. `http://provider.example:8080` |
| `ZOROFIN_STREAMS_XTREAM_USERNAME` | With the address |
| `ZOROFIN_STREAMS_XTREAM_PASSWORD` | With the address (or `_FILE`) |
| `ZOROFIN_STREAMS_USE_PROVIDER_LIMIT` | `0` to keep your own limit even when the provider reports one |
| `ZOROFIN_STREAMS_VIEWER_NAMES` | `admins` (default) or `off` |
| `ZOROFIN_STREAMS_STALE_SECONDS` | Forget a player that hasn't checked in for this long, default 90 |
| `ZOROFIN_STREAMS_LINES` | Optional. Two or more provider logins to share, as their M3U links (or `http://host:port/user/pass`), separated by spaces (or `_FILE`) |
| `ZOROFIN_STREAMS_POOL_TOKEN` | Optional token for the line address; left empty, one is made and kept in `data/liveTvStreams/pool-token` |

Needs `ZOROFIN_JELLYFIN_URL` and `ZOROFIN_JELLYFIN_API_KEY`. To allow more
than one stream, get a plan with more connections from your provider, set
your tuner's limit (for example Threadfin's tuner count) to match, then set
the limit here or let the companion read it from the provider.

### Sharing several logins (line pool)

Many IPTV providers sell only one-connection logins. Buy a second (or third)
login from the same provider and put all of them in **Provider logins to
share**. The companion then serves a *line address*:

```
http://<companion>:9310/v1/public/liveTvStreams/<token>/line/<streamId>
```

Each request opens the stream on whichever login has nothing playing and
relays it; when every login is busy it answers `503` and the tuner shows no
free stream. The in-use count then comes from the pool's open logins, so it
stays right even when Jellyfin can't tell two players apart (two browser tabs
share one Jellyfin session); streams it can't name show as "more channels". Point the channel list's stream addresses at it:

- **Companion channel list** (`liveTvSource`, Xtream): paste the line address
  (without the stream id) into **Shared logins line address**.
- **Threadfin** (or xTeVe): make the playlist's stream addresses use the line
  address (rewrite each provider stream URL to `<line address>/<stream id>`
  in the M3U Threadfin reads), then set the playlist's tuner count to the
  number of logins.

With logins set, the limit is the number of logins (`limitSource: "lines"`),
and administrators get `lines` in the status: logins, capacity, in use, how
many streams opened or were refused, and the line address path. The logins
must be from the same provider (same channel ids). Their passwords are never
logged or returned. Channel numbers, favorites and the guide don't change,
since only the stream address does.

## Module: sportsEvents

Real fixtures for the leagues the operator turns on, put on the channels that
carry them.

- **League packs** (data in `src/modules/sportsEvents/packs.js`, so a new
  league is a new entry): NFL, NBA, MLB, NHL, MLS, WNBA; college football (FBS)
  and men's/women's college basketball; Premier League, LaLiga, Serie A,
  Bundesliga, Ligue 1; Champions League, Europa League, FA Cup; FIFA World Cup
  (men's and women's), Euro and Copa América. Default: `nba, nfl, cfb, mlb,
  nhl, epl, ucl, mls`, in that order of priority (like the apps' Home row).
  Olympics (sessions rather than matches) is not built yet.
- **Fixtures** come from ESPN's public scoreboard for the US Eastern today and
  tomorrow (and yesterday before 5 AM, for late games), every 10 minutes,
  behind one adapter. A failed league keeps its last good schedule.
- **Event channels:** a channel in an event group, or any channel named like
  "Lakers vs Celtics", is matched to exactly one fixture: both teams must
  match (full name, short name, nickname, abbreviation or an alias), a league
  word in the name ("NBA", "Premier League") limits the search, and a time in
  the name ("@ Nov 6 7:30 PM", read in the operator's time zone) settles
  doubleheaders. Anything ambiguous is left alone.
- **Guide listings** from 30 minutes before the start until the final (plus 15
  minutes), titled the way the Zorofin apps and the web Home row read them:
  `NBA Basketball — Los Angeles Lakers at Boston Celtics`, then `Live: ...`
  with the XMLTV live flag once it starts. US leagues read "Away at Home",
  soccer "Home vs Away" (or one style for all). Listings never carry scores.
- **Idle event channels** are hidden, and matched ones are renamed
  "NBA — Lakers at Celtics" (both optional).
- **Network channels**: games get a listing on the channel of the broadcaster
  ESPN lists. Channels are found by name (`ESPN`, `US| ESPN HD`, `NBA TV`,
  `TNT`, `FS1` = `Fox Sports 1`, a local station such as `ABC 7 DC` for ABC);
  streaming services (`ESPN+`, `Peacock`) and names that fit two channels are
  skipped. `ESPN=US| ESPN HD` pairs in `ZOROFIN_SPORTS_NETWORKS` win over the
  automatic match. Two games in one slot are left out.
- **Jellyfin's guide refresh**: Jellyfin reads the guide only when its
  *Refresh Guide* task runs (every 24 hours by default) and reuses a guide it
  downloaded within the last hour. Set that task to every 1-2 hours
  (Dashboard > Scheduled Tasks) so same-day games and `Live:` titles reach the
  guide in time. The web Sports row reads Live now directly and is not delayed.
- **Live now** for the apps: `GET /Zorofin/Companion/sportsEvents/live` (any
  signed-in viewer) returns the games on now, live first, then by league
  priority (or start time, or favorite teams first), with the sport kind the
  apps use for their illustrations, team names, abbreviations and colours,
  broadcasters, matched channels and a favorite flag. `?window=today` adds the
  rest of the next 24 hours. Scores only when the operator turns them on.
  The response also lists `leagues` (ESPN paths the server follows),
  `maxGames` and `order`. The web look's "Sports & live events" row uses this
  feed: cards follow its order and length, favorite teams get a star, and
  scores show under the title when scores are on. Games from a followed league
  that the feed left out are dropped; other live events (boxing, college)
  stay after them. Without the feed, the row keeps its guide-only order.

Setting it up with `liveTvSource`, the guide passes through each step:

1. `liveTvSource` builds `channels.m3u` and `guide.xml`.
2. `sportsEvents` reads both (`ZOROFIN_SPORTS_CHANNELS_URL`,
   `ZOROFIN_SPORTS_GUIDE_URL`) and serves its own
   `/v1/public/sportsEvents/<token>/channels.m3u` and `/guide.xml`.
3. Optionally `liveTvGuide` takes the sports `guide.xml` as its source and adds
   artwork and logos.
4. Jellyfin's M3U tuner reads the sports `channels.m3u`; its XMLTV provider
   reads the last guide in the chain.

Without a channel list the module only serves Live now.

| Variable | Notes |
| --- | --- |
| `ZOROFIN_SPORTS_LEAGUES` | Pack ids in priority order (see above) |
| `ZOROFIN_SPORTS_CHANNELS_URL` | M3U to manage (secret). Empty: Live now only |
| `ZOROFIN_SPORTS_GUIDE_URL` | XMLTV to add the games to (secret, optional) |
| `ZOROFIN_SPORTS_EVENT_GROUPS` | Event-slot group names or prefixes |
| `ZOROFIN_SPORTS_HIDE_IDLE`, `ZOROFIN_SPORTS_RENAME` | `0` to keep idle slots / original names |
| `ZOROFIN_SPORTS_NETWORKS` | `Broadcaster=Channel name` pairs |
| `ZOROFIN_SPORTS_AUTO_NETWORKS` | `0` to use only the pairs above (default: find network channels by name) |
| `ZOROFIN_SPORTS_TITLE_STYLE` | `auto` (default), `at` or `vs` |
| `ZOROFIN_SPORTS_PREGAME_MINUTES`, `ZOROFIN_SPORTS_POSTGAME_MINUTES` | Default 30 and 15 |
| `ZOROFIN_SPORTS_FAVORITES` | Team names, server-wide |
| `ZOROFIN_SPORTS_ORDER` | `league` (default), `start` or `favorites` |
| `ZOROFIN_SPORTS_MAX_GAMES` | Live now size, default 20 |
| `ZOROFIN_SPORTS_SHOW_SCORES` | `1` to include scores in Live now |
| `ZOROFIN_SPORTS_ALIASES` | Extra `Name=Schedule name` pairs |
| `ZOROFIN_SPORTS_TIMEZONE` | Time zone of times in channel names, default `America/New_York` |
| `ZOROFIN_SPORTS_TOKEN` | Needed with a channel list; part of both addresses |
| `ZOROFIN_SPORTS_REFRESH_MINUTES` | Default 10 |

Admins: `GET status` (each league's last fetch, games, live games, channels
listed and matched), `GET preview` (today's fixtures per league with the
channels they matched and the title they get, plus event channels that
matched nothing: the Dashboard's Test view) and `POST refresh`.

**Artwork.** The web pack's live events row now draws the Apple TV app's own
sport illustrations (`apps/apple/Resources/tvOS/.../LiveSport-*.svg`, inlined by
`tools/build-companion-web-ui.cjs`) instead of the web's line drawings, so the
web and the apps show the same art. Team crests and game photos still come from
**Team crests and game photos** in the web look.

## Module: recommendations

A personal "Recommended to request" row of movies that are not on the server
and not requested yet. Taste comes from the viewer's completed and favorite
movies, their own Seerr requests (automated requests are ignored) and their
feedback. Candidates come from Seerr's movie recommendations, so no separate
TMDB key is needed. A viewer needs at least three completed movies; otherwise
the row stays hidden. There is no generic fallback.

Ranking is deterministic by default: titles suggested by several of the
viewer's favorite movies rise to the top, then rating and vote count break ties.

**Optional AI ranking** (off unless the operator turns it on, with their own
key). The AI only reorders the top 60 requestable candidates and adds a short
reason to each; ids it invents are dropped. If the AI call fails or returns
fewer than ten usable items, the feed uses the standard ranking. The feed
reports `ranking: "ai"` or `"standard"`.

| Variable | Notes |
| --- | --- |
| `ZOROFIN_RECOMMENDATIONS_AI` | `anthropic`, `openai` (any OpenAI-compatible chat API) or `off` (default) |
| `ZOROFIN_RECOMMENDATIONS_AI_KEY` | The operator's API key (or `_FILE`). Optional only with a custom URL, for a local server |
| `ZOROFIN_RECOMMENDATIONS_AI_MODEL` | Defaults: `claude-haiku-4-5` / `gpt-4o-mini` |
| `ZOROFIN_RECOMMENDATIONS_AI_URL` | Custom endpoint, e.g. OpenRouter or a local Ollama `http://ollama:11434/v1/chat/completions` |

Titles and overviews go to the chosen AI service with the viewer's top watched
and favorite titles (no names, emails or Jellyfin ids).

Needs `ZOROFIN_SEERR_URL`, `ZOROFIN_SEERR_API_KEY`, `ZOROFIN_JELLYFIN_URL` and
`ZOROFIN_JELLYFIN_API_KEY`.

| Route | Purpose |
| --- | --- |
| `GET feed` | `{ state, items }`; `state` is `preparing`, `not_enough_history` or `ready` |
| `POST feedback` | `{ "tmdbId": n, "action": "not_interested" \| "seen" \| "requested" \| "more_like_this" }` |

Feeds are built on first use, rechecked after 6 hours and rebuilt at least
weekly or when the viewer's taste changes. If Seerr fails, the last good feed
stays. Requesting a title uses the plugin's Requests routes, so Seerr
permissions and quotas still apply.

## Module: webUi

Serves the Zorofin look and web features to Jellyfin's own web client. The
plugin adds one loader script to jellyfin-web when its **Zorofin look in the
web client** setting is on; the loader reads `manifest.json` from this module
and adds the listed styles and scripts. Files come from one flat folder,
`ZOROFIN_WEB_UI_DIR` (default `web-ui/` next to `src/`):

- `*.css` files are listed as styles and `*.js` files as scripts, in name
  order, so prefixes such as `10-theme.css` set the order.
- Names starting with `_` are served but not listed. Only `css`, `js`, `json`,
  `svg`, `png`, `webp` and `woff2` files are served; subfolders and symbolic
  links are not.
- The module advertises `webUi` as enabled only while there is a style or
  script to load, so an empty folder leaves Jellyfin's web client plain.
- `ZOROFIN_WEB_UI_EXTRA_DIR` (optional) adds a second flat folder for one
  server's own add-ons, such as the reference server's private Support
  button and Rewind. Its files follow the same rules, are listed with the pack, and win
  over a pack file with the same name. Name them `70-site-*.js` so no switch
  hides them. Keep the folder outside the image (it is a private mount).
- A file whose name starts with an order number and a part name belongs to
  that part, and is left out while the part is switched off:

  | Part | Files | Setting (Dashboard → Zorofin → Look & player) | Environment | Default |
  | --- | --- | --- | --- | --- |
  | Theme | `NN-theme-*` | Zorofin theme | `ZOROFIN_WEB_UI_THEME` | on |
  | Player | `NN-player*` | Zorofin player | `ZOROFIN_WEB_UI_PLAYER` | on |
  | Home banner | `NN-banner-*` | Home banner (needs the theme) | `ZOROFIN_WEB_UI_BANNER` | on |
  | Live TV | `NN-livetv-*` | Live TV pages and guide (needs the theme) | `ZOROFIN_WEB_UI_LIVE_TV` | on |
  | Requests hub | `NN-requests-*` | Requests hub (needs the theme and Seerr set up in the plugin's Connect step) | `ZOROFIN_WEB_UI_REQUESTS` | off |

- **Requests hub** (`branding/zorofin-requests.js`): talks to the plugin's
  `/Zorofin/Requests` routes as the signed-in viewer, so Jellyfin Enhanced
  isn't needed. Seerr's address and key live in the plugin's Connect step;
  Radarr and Sonarr there add download progress to My requests. On a
  server that loads the scripts some other way, the hub uses Jellyfin
  Enhanced until `window.ZorofinRequestsSource = 'plugin'` is set.
- **Server messages** (`branding/zorofin-server-messages.js`, part of the
  theme): the message written in the plugin's Announcement tab, listed first in
  the Notifications panel with its optional button and Mark read. While it is
  unread the Notifications button shows a dot. It reads `/Zorofin/Announcement`;
  marking it read hides it on the account's other devices too. There is no
  banner over Home. Without a separate support inbox,
  Notifications shows only this message. Nothing shows while the plugin has no
  announcement on.
- **Home banner** (`branding/zorofin-home-banner.js`): up to eight unwatched
  movies and shows with backdrop art, picked at random from the viewer's own
  libraries, rotating across the top of Home every 8 seconds with Play, More
  info and My List. It refreshes every 30 minutes and when the signed-in user
  changes, and swipes on touch screens. It draws the same `#slides-container`
  markup the theme styles for the Media Bar plugin, so the Media Bar plugin
  isn't needed; if it is installed, the Zorofin banner steps aside.
- **Sports artwork** (Look & player → Team crests and game photos,
  `ZOROFIN_WEB_UI_SPORTS_ART`, off by default; needs the Live TV pages): the
  companion builds an `events.json` catalogue, so the
  Home sports row gets game photos and team crests. Every 30 minutes (at most
  every 10) it reads the next two days of NFL, NBA, MLB, NHL, Premier League,
  Championship, Champions League, Europa League, Conference League, Serie A,
  Ligue 1 and Women's Super League fixtures from ESPN's public scoreboard,
  then looks up a dated game photo on TheSportsDB (with
  `ZOROFIN_GUIDE_SPORTSDB_KEY` if set, otherwise its free public key) and
  falls back to the two ESPN team crests. Only PNG and JPEG from those hosts
  are kept, checked and stripped of metadata, under content-hashed names in
  `<data>/webUi/sports-art/art/`. `ZOROFIN_WEB_UI_SPORTS_ART_MAX_MB` (default
  200) caps the folder; unused files go after two days, or oldest first when
  it is full. Zorofin ships no team or broadcaster art: it is downloaded by
  the operator's own server only when they turn this on. Off, or when a
  download fails, the row uses the guide's own image and Zorofin's sport
  illustrations. The manifest adds the `zorofin-sports-art` class so the row
  knows to ask. Admins can read `GET /v1/modules/webUi/sportsArt` (games,
  photos, crests, disk used, last run) and `POST .../sportsArt/refresh`.
  The worker is `src/modules/webUi/sportsArt.js`.
- **Colours and logo** (Look & player, or environment):

  | Setting | Environment | Values |
  | --- | --- | --- |
  | Colours | `ZOROFIN_WEB_UI_COLORS` | `zorofin` (default), `ocean`, `violet`, `rose`, `amber`, `crimson`, `graphite`, `custom` |
  | Accent colour | `ZOROFIN_WEB_UI_ACCENT` | `#rrggbb`, used with `custom` |
  | Card size | `ZOROFIN_WEB_UI_CARD_SIZE` | `compact`, `standard` (default), `large` |
  | Logo | `ZOROFIN_WEB_UI_LOGO` | `zorofin` (default), `custom`, `none` |
  | Logo for wide screens | `ZOROFIN_WEB_UI_LOGO_DESKTOP` | path to a PNG, JPEG or WebP (up to 1 MB) |
  | Logo for phones and TVs | `ZOROFIN_WEB_UI_LOGO_MOBILE` | path to an image; falls back to the wide logo |

  The theme is written in Zorofin green. With another colour, every green in
  its stylesheets and scripts is turned to the accent's hue, keeping each
  colour's lightness, so contrast stays as designed (`src/modules/webUi/palette.js`).
  Logos uploaded in the Dashboard are kept in `<data>/uploads/` and served in
  place of `wordmark.png` and `mark-512.png`; "No logo" adds `32-theme-brand.css`,
  which hides them.
- **Server looks for every viewer and the apps**: `looks.json` (public, through
  the plugin at `/Zorofin/Web/ui/looks.json`, no viewer data) returns
  `{ version: 1, colors, accent: "#rrggbb", cardSize, logo, enforced }`.
  `enforced` (setting "Same look for every viewer", `ZOROFIN_WEB_UI_LOOKS_ENFORCED`,
  default on) tells apps to hide their own look settings; off, it is a default
  viewers can change. The web look
  applies the card size through the `zoro-cards-compact` / `zoro-cards-large`
  class on `<html>`; apps read the same file so every client uses the server's
  accent and card size instead of their own defaults. Changing them needs no
  Jellyfin restart.
- `manifest.json` carries a `version` that changes with the files, colours
  and logo. The plugin loads files under `ui/{version}/` and lets browsers
  cache them for a day, so a change shows on the next reload.
- `manifest.json` also lists `classes` for the page's `<html>` element:
  `zoro-ui` while theme files load, and `zorofin-off-<part>` for each part
  that is off, so the theme can hide links to it. The plugin's loader adds
  them before the styles.

### The Zorofin theme

`web-ui/` is built from the Zorofin web look's sources (`branding/` in the
main Zorofin repository) by `tools/build-companion-web-ui.cjs`, which fails with
`--check` when the folder is out of date. Change the sources and rebuild rather
than editing `web-ui/` by hand. The pack has the same look as Zorofin's own web
release: the pinned Better Jellyfin UI base and Inter font,
the Zorofin shell and navigation, sign-in, Home layout and card badges,
detail pages, episode navigation, collections, search and the account menu.

Left out for now, because they need services the companion doesn't have yet:
the Support button, request alerts bell, download quality, Rewind, the
recommendations row and Live TV availability. Links to them are hidden. They
come back as companion modules serve their data. A server without the Home
Screen Sections, Jellyfin Enhanced and Media Bar plugins gets the theme over
Jellyfin's own Home.
The Notifications bell works like the iOS app's: an unread count, the
server's message (plugin `/Zorofin/Announcement`), requests that are ready to
watch (plugin `/Zorofin/Requests/activity?filter=available`; tap one to open the
title), and rows marked read once seen, then listed under "Hidden".
Home rows now come from the plugin instead of Home Screen Sections: with the
plugin's Home tab on, `35-theme-home-plugin.js` draws every Home row from
`/Zorofin/Home/Sections` (see the plugin README).

The image also ships the **Zorofin web player**
(`40-player.js`): the apps' player layout over Jellyfin web's own video
player. Jellyfin keeps streaming, tracks, subtitles, quality and watch
progress; the Zorofin controls drive Jellyfin's hidden controls and follow its
show/hide. Delete the file (or point `ZOROFIN_WEB_UI_DIR` elsewhere) to keep
Jellyfin's own player. Escape closes Jellyfin's player sheets, and with
Jellyfin Mobile's Native Video Player it hands over full screen and hides the
header and dock. Its browser test lives with the web look's sources in the main
Zorofin repository.

The files load before sign-in, so they are served on the public route
(`GET /v1/public/webUi/{file}`) and must not contain viewer data or secrets.
Signed-in features call other modules through the plugin's bridge as usual.

## Private modules

A server can add modules it keeps to itself with
`ZOROFIN_PRIVATE_MODULES_DIR`. Each `.js` file there exports
`{ id, create(config, deps) }` and is enabled through `ZOROFIN_MODULES` like any
other. Private modules cannot reuse a built-in id. Use this for rules that only make
sense on your own server, such as one provider's Live TV quirks.

## Adding a module

See the interface comment in [src/modules/index.js](src/modules/index.js). A
module advertises exactly one capability named after its id, so the plugin can
proxy only the modules the manifest lists. Add its options to
[src/settings/schemas.js](src/settings/schemas.js), each naming the environment
variable the module reads, so it shows up in the Dashboard. Add tests under
`test/`.
