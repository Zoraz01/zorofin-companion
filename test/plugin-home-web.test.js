'use strict';
// Plugin Home in the companion web pack: helpers in Node, then the rendered Home in
// Chromium against a synthetic /Zorofin/Home/Sections feed, together with the pack's
// Home layout script. All network traffic is blocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PACK = path.join(__dirname, '..', 'web-ui');
const home = require(path.join(PACK, '35-theme-home-plugin.js'));

const card = (id, item, extra = {}) => ({ id, subtitle: '', badges: [], item: { Id: id, ...item }, ...extra });
const FEED = {
  schemaVersion: 1,
  sections: [
    { id: 'continue-watching', title: 'Continue Watching', placement: 'pinned', cards: [
      card('e1', { Type: 'Episode', Name: 'Pilot', SeriesName: 'Show', ParentIndexNumber: 1, IndexNumber: 2, ImageTags: { Primary: 'still' }, RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 250, PlayedPercentage: 25 } }, { subtitle: 'Resume' })] },
    { id: 'requests-ready', title: 'My requests', placement: 'pinned', cards: [card('r1', { Type: 'Movie', Name: 'Asked For', ProductionYear: 2024 }, { badges: ['Ready'] })] },
    { id: 'showcase', title: '4K / HDR showcase', placement: 'personal', cards: [card('m2', { Type: 'Movie', Name: 'Big' }, { badges: ['4K', 'Dolby Vision'] })] },
    { id: 'short-movies', title: 'Watch in 90 minutes', placement: 'personal', cards: [card('m1', { Type: 'Movie', Name: 'Short <b>One</b>', BackdropImageTags: ['b'], CommunityRating: 7.25 }, { subtitle: '88 min' })] },
    { id: 'recently-added-movies', title: 'Recently added movies', placement: 'library', cards: [card('m3', { Type: 'Movie', Name: 'Fresh' })] },
    { id: 'favorites', title: 'Favorites', placement: 'library', cards: [card('m4', { Type: 'Movie', Name: 'Loved' })] },
    { id: 'watch-again', title: 'Watch again', placement: 'library', cards: [] },
    { id: 'bad id!', title: 'x', placement: 'library', cards: [card('z', {})] },
  ],
};

test('helpers', () => {
  assert.deepEqual(home.visibleSections(FEED).map(s => s.id),
    ['continue-watching', 'requests-ready', 'showcase', 'short-movies', 'recently-added-movies', 'favorites'], 'empty and malformed rows are dropped');
  assert.deepEqual(home.visibleSections({ schemaVersion: 2, sections: FEED.sections }), []);
  assert.equal(home.elementId({ id: 'favorites', placement: 'library' }), 'zoroHomeShelf-favorites');
  assert.equal(home.elementId({ id: 'popular', placement: 'personal' }), 'zoroHomeRow-popular');
  assert.equal(home.progress(FEED.sections[0].cards[0]), 25);
  assert.equal(home.progress({ item: { RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 50 } } }), 50);
  assert.equal(home.progress({ item: { UserData: {} } }), null);
  assert.deepEqual(home.imageFor(FEED.sections[0].cards[0]), { id: 'e1', type: 'Primary', tag: 'still' });
  assert.deepEqual(home.readTeams({ CustomPrefs: { zorofinTeams: '["Bulls","Cubs"]' } }), ['Bulls', 'Cubs']);
  assert.deepEqual(home.readTeams({ CustomPrefs: { zorofinTeams: 'oops' } }), []);
  assert.deepEqual(home.mergeTeams({ Id: 'zorofin-home', CustomPrefs: { other: '1' } }, ['Bulls']),
    { Id: 'zorofin-home', Client: 'zorofin', CustomPrefs: { other: '1', zorofinTeams: '["Bulls"]' } });
  const game = card('ch1', { Type: 'TvChannel', Name: 'TNT Sports 1' }, { subtitle: 'Washington Wizards at Boston Celtics' });
  assert.deepEqual(home.sportsCard(game, null), { title: 'Washington Wizards at Boston Celtics', meta: 'TNT Sports 1', logos: [] });
  assert.deepEqual(home.sportsCard(game, { teams: ['Washington Wizards', 'Boston Celtics'], logos: ['a.png', 'b.png'] }),
    { title: 'Washington Wizards vs Boston Celtics', meta: 'TNT Sports 1', logos: ['a.png', 'b.png'] });
});

let playwright;
try { playwright = require('playwright'); } catch (_) { playwright = null; }

test('renders every plugin row and hides the native sections', { skip: !playwright && 'playwright not installed' }, async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      // Jellyfin's own Home markup: numbered sections, one a Live TV section without verticalSection.
      await page.setContent('<div id="indexPage" class="homePage"><div id="homeTab"><div class="sections homeSectionsContainer">' +
        '<div class="verticalSection section0"><h2 class="sectionTitle">My Media</h2></div>' +
        '<div class="verticalSection section1"><h2 class="sectionTitle">Continue Watching</h2></div>' +
        '<div class="section2"><div class="verticalSection"><h2 class="sectionTitle">Live TV</h2></div></div>' +
        '<div class="verticalSection" id="zoroCollections"><h2 class="sectionTitle">Collections</h2></div>' +
        '</div></div></div><a id="avatar" href="#">avatar</a>');
      await page.evaluate(data => {
        location.hash = '#/home';
        window.calls = [];
        window.ApiClient = {
          accessToken: () => 'fixture-token', getCurrentUserId: () => 'u1', serverId: () => 'srv',
          getImageUrl: (id, o) => 'https://img.invalid/' + id + '?' + new URLSearchParams(o),
          getUrl: p => 'https://media.invalid/' + p,
        };
        window.fetch = async (url, options = {}) => {
          const body = options.body ? JSON.parse(options.body) : null;
          calls.push({ url: String(url), method: options.method || 'GET', body, headers: options.headers });
          if (String(url).startsWith('https://media.invalid/Zorofin/Home/Sections')) return { ok: true, status: 200, json: async () => data };
          if (String(url).includes('DisplayPreferences')) {
            if (options.method === 'POST') return { ok: true, status: 204, json: async () => null };
            return { ok: true, status: 200, json: async () => ({ Id: 'zorofin-home', CustomPrefs: { zorofinTeams: '["Bulls"]', keep: 'me' } }) };
          }
          throw new Error('unexpected ' + url);
        };
      }, JSON.parse(JSON.stringify(FEED)));
      await page.evaluate(() => document.documentElement.classList.add('zoro-ui', 'zoro-shell-active'));
      await page.addStyleTag({ path: path.join(PACK, '30-theme-shell.css') });
      await page.addScriptTag({ path: path.join(PACK, '35-theme-home-layout.js') });
      await page.addScriptTag({ path: path.join(PACK, '35-theme-home-plugin.js') });
      await page.locator('#zoroHomeRow-short-movies').waitFor();
      // Jellyfin Enhanced's hidden-content filter hides a "Continue Watching" row with no .card elements.
      await page.evaluate(() => { document.getElementById('zoroHomeRow-continue-watching').style.display = 'none'; });
      await page.waitForTimeout(400);
      if (process.env.PLUGIN_HOME_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.PLUGIN_HOME_SCREENSHOTS, 'plugin-home-' + width + '.png'), fullPage: true });

      const visible = await page.evaluate(() => [...document.querySelectorAll('#homeTab .sections > *')]
        .filter(e => getComputedStyle(e).display !== 'none')
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map(e => e.querySelector('h2').textContent));
      assert.deepEqual(visible.slice(0, 2), ['Continue Watching', 'My requests'], 'Continue Watching then My requests stay on top: ' + visible);
      assert.deepEqual([...visible].sort(), ['4K / HDR showcase', 'Collections', 'Continue Watching', 'Favorites', 'My requests', 'Recently added movies', 'Watch in 90 minutes'],
        'native My Media, Continue Watching and Live TV give way; collections stay');
      assert.ok(visible.indexOf('Recently added movies') < visible.indexOf('Favorites'), 'library shelves keep their order');
      const pageOrder = await page.evaluate(() => [...document.querySelectorAll('#homeTab .sections > *')]
        .filter(e => getComputedStyle(e).display !== 'none').map(e => e.querySelector('h2').textContent));
      assert.deepEqual(pageOrder, visible, 'page order matches what the viewer sees');
      assert.equal(await page.locator('#zoroHomeRow-continue-watching').getAttribute('class'), 'zoroBrowseRow verticalSection zoroHomeRow ContinueWatchingNextUp');
      assert.equal(await page.locator('#zoroHomeRow-continue-watching .zoroBrowseMeta').textContent(), 'S1 · E2 · Pilot');
      assert.equal(await page.locator('#zoroHomeRow-continue-watching .zph-progress > span').getAttribute('style'), 'width: 25%;');
      assert.equal(await page.locator('#zoroHomeRow-short-movies .zoroBrowseTitle').textContent(), 'Short <b>One</b>', 'titles are text, not HTML');
      assert.equal(await page.locator('#zoroHomeRow-short-movies .zoroBrowseMeta').textContent(), '88 min');
      assert.equal(await page.locator('#zoroHomeRow-short-movies .zoroBrowseRating').textContent(), '★ 7.3');
      assert.deepEqual(await page.locator('#zoroHomeRow-showcase .zph-badge').allTextContents(), ['4K', 'Dolby Vision']);
      // Movie and show rows use posters with one caption line, as in the apps; wide rows stay wide.
      assert.equal(await page.locator('#zoroHomeRow-requests-ready .zoroBrowseMeta').textContent(), 'Ready');
      assert.equal(await page.locator('#zoroHomeRow-requests-ready .zph-context').count(), 0);
      assert.equal(await page.locator('#zoroHomeRow-short-movies').evaluate(e => e.classList.contains('zoroPosterRow')), true);
      assert.equal(await page.locator('#zoroHomeRow-continue-watching').evaluate(e => e.classList.contains('zoroPosterRow')), false);
      const ratio = await page.locator('#zoroHomeRow-short-movies .zoroBrowsePoster').first().evaluate(e => getComputedStyle(e).aspectRatio);
      assert.match(ratio, /2 \/ 3/, 'poster shape: ' + ratio);
      assert.equal(await page.locator('.zoroHomeRow .sectionTitleContainer p, .zoroHomeRow button').count(), 0, 'no subheadings or buttons on rows');
      assert.equal(await page.evaluate(() => calls[0].headers.Authorization), 'MediaBrowser Token="fixture-token"');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no page overflow at ' + width);

      await page.evaluate(() => window.zorofinOpenTeams(document.getElementById('avatar')));
      await page.getByRole('dialog', { name: 'See your teams on Home' }).waitFor();
      await page.waitForFunction(() => !document.getElementById('zphTeams').disabled);
      assert.equal(await page.locator('#zphTeams').inputValue(), 'Bulls');
      await page.locator('#zphTeams').fill('Bulls, Cubs');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      const saved = await page.evaluate(() => calls.find(c => c.method === 'POST'));
      assert.equal(saved.url, 'https://media.invalid/DisplayPreferences/zorofin-home?userId=u1&client=zorofin');
      assert.deepEqual(saved.body.CustomPrefs, { zorofinTeams: '["Bulls","Cubs"]', keep: 'me' }, 'other preferences are kept');
      await page.waitForFunction(() => calls.some(c => c.url.endsWith('Zorofin/Home/Sections?fresh=true')));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('without the plugin feed, Jellyfin\'s own Home stays', { skip: !playwright && 'playwright not installed' }, async () => {
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<div id="indexPage" class="homePage"><div id="homeTab"><div class="sections"><div class="verticalSection section0"><h2>Native</h2></div></div></div></div>');
    await page.evaluate(() => {
      location.hash = '#/home';
      window.calls = 0;
      window.ApiClient = { accessToken: () => 't', getCurrentUserId: () => 'u1', serverId: () => 'srv', getUrl: p => 'https://media.invalid/' + p };
      window.fetch = async () => { calls++; return { ok: false, status: 404, json: async () => ({}) }; };
    });
    await page.addScriptTag({ path: path.join(PACK, '35-theme-home-plugin.js') });
    await page.waitForFunction(() => calls > 0);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.section0').isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('zoro-plugin-home')), false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => calls), 1, 'a server without plugin Home is not asked again');
  } finally { await browser.close(); }
});

test('your teams: the game and both crests, with the channel underneath', { skip: !playwright && 'playwright not installed' }, async () => {
  const fs = require('node:fs');
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Crest images come from the pack; serve a 1px PNG for them and block everything else.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.route('**/*', route => /^https:\/\/(?:pack\.invalid\/live-tv-logos|media\.invalid\/Zorofin\/Web\/ui\/live-tv-logos)\/art\/.*\.png$/.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'image/png', body: png }) : route.abort());
    await page.setContent('<div id="indexPage" class="homePage"><div id="homeTab"><div class="sections homeSectionsContainer">' +
      '<div class="verticalSection section0"><h2 class="sectionTitle">My Media</h2></div></div></div></div>');
    const start = new Date(Date.now() + 20 * 60000).toISOString();
    const sports = { schemaVersion: 1, sections: [{ id: 'sports', title: 'Your teams / starting soon', placement: 'personal', cards: [
      card('p1', { Type: 'TvChannel', Name: 'TNT Sports 1' }, { subtitle: 'Washington Wizards at Boston Celtics', badges: ['Starting soon'], startsAt: start }),
      card('p2', { Type: 'TvChannel', Name: 'Sports 2' }, { subtitle: 'Manchester United vs Chelsea', badges: ['On now'], startsAt: start }),
      // Newer plugins send the matchup and crests themselves.
      card('p3', { Type: 'TvChannel', Name: 'ESPN' }, { subtitle: 'Washington Commanders at Dallas Cowboys', badges: ['Starting soon'], startsAt: start,
        matchup: ['Washington Commanders', 'Dallas Cowboys'],
        crests: ['Zorofin/Web/ui/live-tv-logos/art/sports-cccccccccccccccccccccccc-00000003.png', 'Zorofin/Web/ui/live-tv-logos/art/sports-dddddddddddddddddddddddd-00000004.png'] })] }] };
    const catalogue = { version: 2, events: [{ id: 'g1', league: 'basketball/nba', sport: 'basketball', start,
      away: { id: 'w', name: 'Washington Wizards', aliases: ['washington wizards'] }, home: { id: 'c', name: 'Boston Celtics', aliases: ['boston celtics'] },
      image: '', logos: ['/live-tv-logos/art/sports-aaaaaaaaaaaaaaaaaaaaaaaa-00000001.png', '/live-tv-logos/art/sports-bbbbbbbbbbbbbbbbbbbbbbbb-00000002.png'] }] };
    await page.evaluate(([data, art]) => {
      location.hash = '#/home';
      window.calls = [];
      window.ZorofinWeb = { base: 'https://pack.invalid/', liveArtwork: true };
      window.ApiClient = {
        accessToken: () => 'fixture-token', getCurrentUserId: () => 'u1', serverId: () => 'srv',
        getImageUrl: (id, o) => 'https://img.invalid/' + id + '?' + new URLSearchParams(o), getUrl: p => 'https://media.invalid/' + p,
      };
      window.fetch = async url => {
        calls.push(String(url));
        if (String(url).startsWith('https://media.invalid/Zorofin/Home/Sections')) return { ok: true, status: 200, json: async () => data };
        if (String(url).startsWith('https://pack.invalid/live-tv-logos/art/events.json')) return { ok: true, status: 200, json: async () => art };
        throw new Error('unexpected ' + url);
      };
    }, [sports, catalogue]);
    // The live events script's helpers, without mounting its own row.
    await page.addScriptTag({ content: '(function(module){' + fs.readFileSync(path.join(PACK, '52-livetv-events.js'), 'utf8') +
      '\nwindow.zorofinLiveEventTools=module.exports;})({exports:{}});' });
    await page.evaluate(() => document.documentElement.classList.add('zoro-ui', 'zoro-shell-active'));
    await page.addStyleTag({ path: path.join(PACK, '30-theme-shell.css') });
    await page.addScriptTag({ path: path.join(PACK, '35-theme-home-plugin.js') });
    await page.locator('#zoroHomeRow-sports').waitFor();
    await page.locator('#zoroHomeRow-sports .zph-crests img').first().waitFor();
    if (process.env.PLUGIN_HOME_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.PLUGIN_HOME_SCREENSHOTS, 'plugin-home-sports.png') });

    assert.deepEqual(await page.locator('#zoroHomeRow-sports .zoroBrowseTitle').allTextContents(),
      ['Washington Wizards vs Boston Celtics', 'Manchester United vs Chelsea', 'Washington Commanders vs Dallas Cowboys']);
    assert.deepEqual(await page.locator('#zoroHomeRow-sports .zoroBrowseMeta').allTextContents(), ['TNT Sports 1', 'Sports 2', 'ESPN']);
    assert.equal(await page.locator('#zoroHomeRow-sports .zph-crests').count(), 2, 'crests only where the server or the catalogue has the fixture');
    assert.deepEqual(await page.locator('#zoroHomeRow-sports .zph-crests img').evaluateAll(imgs => imgs.map(i => i.getAttribute('src'))),
      catalogue.events[0].logos.map(p => 'https://pack.invalid' + p).concat(sports.sections[0].cards[2].crests.map(p => 'https://media.invalid/' + p)));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
