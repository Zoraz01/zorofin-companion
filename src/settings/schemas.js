'use strict';

// What the Jellyfin Dashboard shows for each part of the companion. Every
// option maps to the environment variable the module already reads, so a
// value saved in the Dashboard simply takes that variable's place, and an
// install configured only with environment variables keeps working.
//
// Option types: text, url, secret (write-only), boolean, number, choice, list,
// color (#rrggbb) and image (an upload kept in the data folder; the variable
// holds its path).

const { PRESETS } = require('../modules/webUi/palette');

const SECTIONS = Object.freeze({
  connections: {
    kind: 'core',
    title: 'Connections',
    description: 'How the companion reaches Jellyfin and Seerr. Used by every module.',
    options: [
      { key: 'jellyfinUrl', env: 'ZOROFIN_JELLYFIN_URL', type: 'url', label: 'Jellyfin address', help: 'How the companion reaches Jellyfin, for example http://jellyfin:8096.', placeholder: 'http://jellyfin:8096' },
      { key: 'jellyfinApiKey', env: 'ZOROFIN_JELLYFIN_API_KEY', type: 'secret', label: 'Jellyfin API key', help: 'Dashboard → API Keys. Used for read-only library and history lookups.' },
      { key: 'seerrUrl', env: 'ZOROFIN_SEERR_URL', type: 'url', label: 'Seerr address', placeholder: 'http://seerr:5055' },
      { key: 'seerrApiKey', env: 'ZOROFIN_SEERR_API_KEY', type: 'secret', label: 'Seerr API key', help: 'Seerr → Settings → General.' },
      { key: 'serverName', env: 'ZOROFIN_SERVER_NAME', type: 'text', label: 'Server name', help: 'Shown in emails and alerts.', placeholder: 'Zorofin', max: 80 },
      { key: 'appUrl', env: 'ZOROFIN_APP_URL', type: 'url', label: 'Address viewers open', help: 'Links in emails and alerts point here.', placeholder: 'https://media.example.com' },
    ],
  },
  notifications: {
    kind: 'module',
    title: 'Request alerts',
    description: 'Tells viewers by email or push when something they requested is ready to watch.',
    options: [
      { key: 'emailFrom', env: 'ZOROFIN_NOTIFY_EMAIL_FROM', type: 'text', label: 'Email sender', placeholder: 'Zorofin <alerts@example.com>', max: 320 },
      { key: 'emailReplyTo', env: 'ZOROFIN_NOTIFY_EMAIL_REPLY_TO', type: 'text', label: 'Reply-to address', max: 320 },
      { key: 'emailApiKey', env: 'ZOROFIN_NOTIFY_EMAIL_API_KEY', type: 'secret', label: 'Email service API key', help: 'Resend, or a compatible service at the address below.' },
      { key: 'emailApiUrl', env: 'ZOROFIN_NOTIFY_EMAIL_API_URL', type: 'url', label: 'Email service address', placeholder: 'https://api.resend.com' },
      { key: 'ntfyUrl', env: 'ZOROFIN_NOTIFY_NTFY_URL', type: 'url', label: 'ntfy address', help: 'For push alerts. Leave empty to use email only.', placeholder: 'http://ntfy:80' },
      { key: 'ntfyPublicUrl', env: 'ZOROFIN_NOTIFY_NTFY_PUBLIC_URL', type: 'url', label: 'ntfy address for viewers' },
      { key: 'ntfyToken', env: 'ZOROFIN_NOTIFY_NTFY_TOKEN', type: 'secret', label: 'ntfy publish token' },
      { key: 'ntfyAdminToken', env: 'ZOROFIN_NOTIFY_NTFY_ADMIN_TOKEN', type: 'secret', label: 'ntfy admin token', help: 'Lets the companion create a private ntfy login for each viewer.' },
    ],
  },
  liveTvGuide: {
    kind: 'module',
    title: 'Live TV guide',
    description: 'Improves your XMLTV guide: game matchups, show and sports artwork, and channel logos.',
    options: [
      { key: 'sourceUrl', env: 'ZOROFIN_GUIDE_SOURCE_URL', type: 'url', label: 'Guide to improve (XMLTV)', placeholder: 'http://threadfin:34400/xmltv/threadfin.xml' },
      { key: 'token', env: 'ZOROFIN_GUIDE_TOKEN', type: 'secret', label: 'Guide link token', help: '32–128 letters or digits. Part of the guide address you give Jellyfin.' },
      { key: 'publicUrl', env: 'ZOROFIN_GUIDE_PUBLIC_URL', type: 'url', label: 'Companion address for Jellyfin', help: 'Needed for artwork.', placeholder: 'http://zorofin-companion:9310' },
      { key: 'refreshMinutes', env: 'ZOROFIN_GUIDE_REFRESH_MINUTES', type: 'number', label: 'Refresh every (minutes)', min: 5, max: 1440, default: 30 },
      { key: 'matchupTitles', env: 'ZOROFIN_GUIDE_MATCHUP_TITLES', type: 'boolean', label: 'Game matchup titles', default: true },
      { key: 'tvmaze', env: 'ZOROFIN_GUIDE_TVMAZE', type: 'boolean', label: 'Show artwork from TVmaze', default: false },
      { key: 'sportsDbKey', env: 'ZOROFIN_GUIDE_SPORTSDB_KEY', type: 'secret', label: 'TheSportsDB key', help: 'Optional, for sports artwork.' },
      { key: 'channelLogos', env: 'ZOROFIN_GUIDE_CHANNEL_LOGOS', type: 'boolean', label: 'Fill in missing channel logos', help: 'Matches each channel without a logo to one in the free tv-logos collection on GitHub, and keeps a copy on your server. 4K and HD channels get the plain channel logo.', default: false },
      { key: 'logoCountries', env: 'ZOROFIN_GUIDE_LOGO_COUNTRIES', type: 'list', label: 'Logo countries', help: 'Which tv-logos country folders to look in. Comma-separated, for example united-states,united-kingdom.', placeholder: 'united-states', when: ['channelLogos', true] },
      { key: 'logoOverrides', env: 'ZOROFIN_GUIDE_LOGO_OVERRIDES', type: 'list', label: 'Use this logo for a channel', help: 'For channels that get no logo or the wrong one. Comma-separated "Channel name=logo", where the logo is a tv-logos file name (any country), an https image address, or none. Example: NBC 4 Washington=nbc-4-washington-us.png, Local Access=none', placeholder: 'NBC 4 Washington=nbc-4-washington-us.png', when: ['channelLogos', true] },
    ],
  },
  liveTvStreams: {
    kind: 'module',
    title: 'Live TV streams',
    description: 'Shows viewers how many Live TV streams your provider allows and which channels are using them.',
    options: [
      { key: 'limit', env: 'ZOROFIN_STREAMS_LIMIT', type: 'number', label: 'Streams your provider allows', help: 'How many different channels can play at once. Viewers of the same channel share one stream. Match your Threadfin tuner count.', min: 1, max: 50, default: 1 },
      { key: 'xtreamUrl', env: 'ZOROFIN_STREAMS_XTREAM_URL', type: 'url', label: 'Provider address (Xtream)', help: 'Optional. Lets the companion read your real stream limit and spot streams used by other apps.', placeholder: 'http://provider.example:8080' },
      { key: 'xtreamUsername', env: 'ZOROFIN_STREAMS_XTREAM_USERNAME', type: 'text', label: 'Provider username', max: 200 },
      { key: 'xtreamPassword', env: 'ZOROFIN_STREAMS_XTREAM_PASSWORD', type: 'secret', label: 'Provider password' },
      { key: 'useProviderLimit', env: 'ZOROFIN_STREAMS_USE_PROVIDER_LIMIT', type: 'boolean', label: "Use the provider's limit when known", default: true },
      { key: 'viewerNames', env: 'ZOROFIN_STREAMS_VIEWER_NAMES', type: 'choice', label: 'Who is watching', choices: [['admins', 'Shown to administrators'], ['off', 'Hidden from everyone']], default: 'admins', help: 'Viewers only ever see channel names, never other people.' },
      { key: 'staleSeconds', env: 'ZOROFIN_STREAMS_STALE_SECONDS', type: 'number', label: 'Forget a silent player after (seconds)', min: 30, max: 900, default: 90 },
    ],
  },
  recommendations: {
    kind: 'module',
    title: 'Recommendations',
    description: 'Suggests titles each viewer can request, based on what they watch.',
    options: [
      { key: 'ai', env: 'ZOROFIN_RECOMMENDATIONS_AI', type: 'choice', label: 'AI ranking', choices: [['off', 'Off'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI-compatible']], default: 'off', help: 'Optional. Uses your own key; if it fails, the standard ranking is used.' },
      { key: 'aiKey', env: 'ZOROFIN_RECOMMENDATIONS_AI_KEY', type: 'secret', label: 'AI API key' },
      { key: 'aiModel', env: 'ZOROFIN_RECOMMENDATIONS_AI_MODEL', type: 'text', label: 'AI model', help: 'Leave empty for the default.', max: 120 },
      { key: 'aiUrl', env: 'ZOROFIN_RECOMMENDATIONS_AI_URL', type: 'url', label: 'AI address', help: 'Only for a self-hosted OpenAI-compatible server.' },
    ],
  },
  webUi: {
    kind: 'module',
    title: 'Zorofin web look and player',
    description: 'Gives Jellyfin\'s web client the Zorofin look and player. Viewers reload their browser tab to see a change.',
    options: [
      { key: 'theme', env: 'ZOROFIN_WEB_UI_THEME', type: 'boolean', label: 'Zorofin theme', help: 'Navigation, Home, detail pages, sign-in and colours, like the Zorofin apps.', default: true },
      { key: 'player', env: 'ZOROFIN_WEB_UI_PLAYER', type: 'boolean', label: 'Zorofin player', help: 'Zorofin\'s playback controls. Playback itself stays Jellyfin\'s.', default: true },
      { key: 'banner', env: 'ZOROFIN_WEB_UI_BANNER', type: 'boolean', label: 'Home banner', help: 'Featured movies and shows across the top of Home. It uses unwatched titles that have backdrop art and a description, so it stays hidden until your library has some. Steps aside if the Media Bar plugin is installed.', default: true },
      { key: 'pauseScreen', env: 'ZOROFIN_WEB_UI_PAUSE_SCREEN', type: 'boolean', label: 'Pause screen', help: 'A few seconds after a video is paused, the player shows the title\'s art, details and progress. Any key or mouse move brings the player back.', default: true },
      { key: 'autoPause', env: 'ZOROFIN_WEB_UI_AUTO_PAUSE', type: 'boolean', label: 'Pause when switching tabs', help: 'Pauses the video when the viewer switches to another browser tab, and resumes it when they come back.', default: true, when: ['pauseScreen', true] },
      { key: 'liveTv', env: 'ZOROFIN_WEB_UI_LIVE_TV', type: 'boolean', label: 'Live TV pages and guide', help: 'Needs the theme.', default: true },
      { key: 'sportsArt', env: 'ZOROFIN_WEB_UI_SPORTS_ART', type: 'boolean', label: 'Team crests and game photos', default: false,
        help: 'For the sports row on Home. Your server downloads the next two days of NFL, NBA, MLB, NHL and major soccer fixtures, with team crests from ESPN and game photos from TheSportsDB. Left off, the row uses the guide\'s own images and Zorofin\'s sport illustrations. Needs the Live TV pages.' },
      { key: 'sportsArtMaxMb', env: 'ZOROFIN_WEB_UI_SPORTS_ART_MAX_MB', type: 'number', label: 'Space for sports artwork (MB)', min: 20, max: 2000, default: 200, when: ['sportsArt', true],
        help: 'Older crests and photos are removed first when it fills up.' },
      { key: 'requests', env: 'ZOROFIN_WEB_UI_REQUESTS', type: 'boolean', label: 'Requests hub', help: 'Discover, request and follow movies and shows. Needs the theme, and Seerr connected in the Connect step.', default: false },
      { key: 'colors', env: 'ZOROFIN_WEB_UI_COLORS', type: 'choice', display: 'swatches', label: 'Colours', default: 'zorofin',
        choices: [...Object.entries(PRESETS).map(([id, preset]) => [id, preset.label, preset.color]), ['custom', 'Custom', '']] },
      { key: 'accent', env: 'ZOROFIN_WEB_UI_ACCENT', type: 'color', label: 'Accent colour', default: '#42d779', when: ['colors', 'custom'],
        help: 'Buttons, focus, progress and highlights. Backgrounds take a hint of it too.' },
      { key: 'logo', env: 'ZOROFIN_WEB_UI_LOGO', type: 'choice', label: 'Logo', default: 'zorofin',
        choices: [['zorofin', 'Zorofin'], ['custom', 'Your own'], ['none', 'No logo']] },
      { key: 'logoDesktop', env: 'ZOROFIN_WEB_UI_LOGO_DESKTOP', type: 'image', slot: 'wordmark.png', label: 'Logo for wide screens', when: ['logo', 'custom'],
        help: 'PNG, JPEG or WebP up to 1 MB. A wide logo, about 4 to 1, on a transparent background.' },
      { key: 'logoMobile', env: 'ZOROFIN_WEB_UI_LOGO_MOBILE', type: 'image', slot: 'mark-512.png', label: 'Logo for phones and TVs', when: ['logo', 'custom'],
        help: 'A square mark, at least 256 px. Leave empty to use the wide logo.' },
    ],
  },
});

module.exports = { SECTIONS };
