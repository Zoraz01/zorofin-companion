# Third-party notices

The companion's own code is under AGPL-3.0-only (see `LICENSE`). These files in
`web-ui/` come from other projects and keep their own licenses:

| Files | Source | License |
| --- | --- | --- |
| `10-theme-base.css`, `11-theme-hover.css`, `12-theme-borders.css` | [tromoSM/better-jellyfin-ui](https://github.com/tromoSM/better-jellyfin-ui) at `b9b2cd6a`, with the font URL changed to the bundled file | Apache-2.0, `web-ui/LICENSE-better-jellyfin-ui` |
| `InterVariable.woff2` | [rsms/inter](https://github.com/rsms/inter) (Inter font) | SIL Open Font License 1.1, `web-ui/LICENSE-Inter-OFL` |
| `mark-512.png`, `wordmark.png` | Zorofin logo | Not open source; see `TRADEMARKS.md` |

Some detail-page styles follow the layout ideas of
[AumGupta/abyss-jellyfin](https://github.com/AumGupta/abyss-jellyfin) (MIT).
No Abyss code is included.

At run time, modules the operator turns on download data from services the
operator chooses (for example TVmaze, TheSportsDB, ESPN's public scoreboard,
the tv-logos collection, Resend, ntfy, or an AI provider with the operator's
own key). Their terms apply to the operator's use; the companion ships none of
their data.
