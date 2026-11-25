# Install the companion on a NAS

The companion is one container: image `ghcr.io/zoraz01/zorofin-companion`,
port `9310`, one data folder on `/data`. These templates set it up on the
common home-server systems. All of them need the
[Zorofin plugin](https://github.com/Zoraz01/jellyfin-plugin-zorofin) in
Jellyfin first (Dashboard → Plugins → Repositories → add
`https://raw.githubusercontent.com/Zoraz01/jellyfin-plugin-zorofin/main/manifest.json`).

Every install ends the same way:

1. Start the container and open its log. On first start it prints a
   **bridge secret** (also saved in its data folder as `bridge-secret`).
2. In Jellyfin, open Dashboard → Plugins → Zorofin and set
   - **Companion URL**: `http://<your server's IP>:9310`
   - **Companion secret**: the bridge secret.
3. Switch modules on from the plugin's **Companion settings** page.

Keep port 9310 on your local network. Don't forward it to the internet.

| System | File | How |
| --- | --- | --- |
| Unraid | [unraid/zorofin-companion.xml](unraid/zorofin-companion.xml) | Community Applications (search "Zorofin") or the template URL below |
| TrueNAS SCALE 24.10+ | [truenas/docker-compose.yml](truenas/docker-compose.yml) | Apps → Discover Apps → ⋮ → Install via YAML |
| CasaOS / ZimaOS | [casaos/docker-compose.yml](casaos/docker-compose.yml) | App Store → Custom Install → Import, paste the file |
| Anything with Docker Compose | [../compose.yaml](../compose.yaml) | See the main README |

## Unraid

Until the app is listed in Community Applications: on the Docker tab, add
`https://github.com/Zoraz01/zorofin-companion` to the **Template
repositories** box and save, then Add Container and pick
**zorofin-companion** from the template list. Or download the XML into
`/boot/config/plugins/dockerMan/templates-user/`.

Defaults: Appdata `/mnt/user/appdata/zorofin-companion`, runs as 99:100 like
other Unraid apps. Set **Jellyfin URL** to `http://<server IP>:8096`.

## TrueNAS SCALE

1. Create a dataset for it, for example `tank/apps/zorofin-companion`, with
   the **Apps** preset.
2. Apps → Discover Apps → ⋮ → **Install via YAML**, name it
   `zorofin-companion`, paste [truenas/docker-compose.yml](truenas/docker-compose.yml)
   and change the volume path to your dataset.
3. Fill in `ZOROFIN_JELLYFIN_URL` (the Jellyfin app's address, for example
   `http://<server IP>:30013`).

It runs as 568:568, TrueNAS's `apps` user.

## CasaOS / ZimaOS

App Store → **Custom Install** → Import (top right) → paste
[casaos/docker-compose.yml](casaos/docker-compose.yml) → Install. Then set
`ZOROFIN_JELLYFIN_URL` in the app's settings.

## Updating

Unraid uses `:latest`. The TrueNAS and CasaOS files pin a version
(`:0.3.0`); change the tag to update. Releases and what changed:
[CHANGELOG.md](../CHANGELOG.md).

## Getting listed (maintainer notes)

These are the owner's steps; nothing here is submitted automatically.

**Unraid Community Applications.** CA lists templates from public GitHub
repositories, so this repository already works as a template repository.
1. Open a support thread for Zorofin Companion in the Unraid forums
   (Docker Containers section). CA wants every app to have one.
2. Put that thread's link in `<Support>` in the XML and sync.
3. Submit the repository through the Community Applications submission
   form (linked from the CA support thread on forums.unraid.net). The
   moderators review it, usually within a few days.

**CasaOS / ZimaOS App Store.** A pull request to
`IceWhaleTech/CasaOS-AppStore` adding `Apps/ZorofinCompanion/` with
`docker-compose.yml` (this file), `icon.png`, `thumbnail.png` and at least one
screenshot (`screenshot-1.png`, for example the plugin's Companion settings
page), and the icon/screenshot links changed to their jsDelivr paths. Read
that repository's contributing guide first; it sometimes asks new apps to go
to a community store such as BigBear first.

**TrueNAS community catalog.** A pull request to `truenas/apps` adding
`ix-dev/community/zorofin-companion/` in their app library format (questions
form, templates, tests). It's a bigger job than the others; worth doing once
users ask for it. Until then, Install via YAML covers TrueNAS.

**Umbrel.** Not planned for now: Umbrel's store expects an app with its own
web page behind its proxy, and the companion has none (it's configured from
Jellyfin).
