# Changelog

All notable changes to the Zorofin companion. Versions follow semantic
versioning: minor for new features, patch for fixes. Each release is the git
tag `v<version>` here and the image `ghcr.io/zoraz01/zorofin-companion:<version>`
(plus `:latest`).

## 0.2.0 (November 25, 2026)

First tagged release and the first `:latest` image.

- `pickTogether`: a group swipes on their phones and sees the titles everyone
  liked; hosted on the web TV layout and in Catch Up.
- `sportsEvents`: live games from your own channels, listed once per game,
  with home-team-first soccer scores and team crests; one-time broadcasts are
  featured.
- `recommendations`: "Recommended to request" follows what viewers watch, uses
  each viewer's Pick Together swipes, and runs AI picks at most once a day per
  viewer.
- `liveTvGuide`: rebuilds as soon as its source changes; channel logos shown
  whole; missing guide artwork repaired.
- `webUi`: posters for movie and show rows, the TV-order avatar menu, muted
  trailer previews on web TV, Catch Up cards, shared notification read state,
  support for older TV browsers, and scoped deploy with rollback.

## 0.1.0 (November 6, 2026)

Source published; image built from `main` only (`:edge`).
