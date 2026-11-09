/* Zorofin Home from the Zorofin plugin, in place of the Home Screen Sections plugin.
 * Ships only in the companion web pack (tools/build-companion-web-ui.cjs); the reference server's
 * Injector scripts don't load it. When the server's plugin has Home rows switched on,
 * /Zorofin/Home/Sections lists every Home row for the signed-in viewer: Continue Watching,
 * My requests, the personal rows the apps show (new episodes, 90 minutes, 4K / HDR,
 * seasonal, popular, your teams, because you watched) and the library shelves
 * (favorites, recently added, watch again). Jellyfin's own Home sections, and Home Screen
 * Sections' rows if that plugin is still installed, are hidden while these show.
 * zorofin-home-layout.js orders the rows like the apps: Continue Watching, live events,
 * My requests, then the personal rows mixed in among the library shelves. Empty rows
 * never reach the page. Without the plugin feed, Jellyfin's own Home stays as it is. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  var PLACEMENTS = ['pinned', 'personal', 'library'];
  var TEAMS_PREFS = 'zorofin-home', TEAMS_KEY = 'zorofinTeams';
  var ON = 'zoro-plugin-home';

  // Sections worth drawing: known placement, a title and at least one card.
  function visibleSections(feed) {
    if (!feed || feed.schemaVersion !== 1 || !Array.isArray(feed.sections)) return [];
    var seen = Object.create(null);
    return feed.sections.filter(function (section) {
      var ok = section && typeof section.id === 'string' && /^[a-z0-9-]{1,48}$/.test(section.id) && !seen[section.id] &&
        PLACEMENTS.indexOf(section.placement) >= 0 && typeof section.title === 'string' && Array.isArray(section.cards) && section.cards.length > 0;
      if (ok) seen[section.id] = true;
      return ok;
    });
  }
  // Personal and pinned rows use zoroHomeRow- ids, which zorofin-home-layout.js pins
  // (Continue Watching, My requests) or mixes in at random. Library shelves keep
  // their own order, like the configured rows they replace.
  function elementId(section) {
    return (section.placement === 'library' ? 'zoroHomeShelf-' : 'zoroHomeRow-') + section.id;
  }
  // Landscape artwork like the other Home shelves: an episode's still, the item's
  // thumb or backdrop, then the show's backdrop.
  function imageFor(card) {
    var item = (card && card.item) || {}, tags = item.ImageTags || {};
    if (item.Type === 'Episode' && tags.Primary) return { id: item.Id, type: 'Primary', tag: tags.Primary };
    if (tags.Thumb) return { id: item.Id, type: 'Thumb', tag: tags.Thumb };
    if (item.BackdropImageTags && item.BackdropImageTags.length) return { id: item.Id, type: 'Backdrop', tag: item.BackdropImageTags[0] };
    if (item.ParentThumbItemId && item.ParentThumbImageTag) return { id: item.ParentThumbItemId, type: 'Thumb', tag: item.ParentThumbImageTag };
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length) {
      return { id: item.ParentBackdropItemId, type: 'Backdrop', tag: item.ParentBackdropImageTags[0] };
    }
    if (tags.Primary) return { id: item.Id, type: 'Primary', tag: tags.Primary };
    return null;
  }
  function metaFor(section, card) {
    var item = card.item || {};
    if ((section.id === 'short-movies' || section.id === 'sports') && card.subtitle) return card.subtitle;
    if (item.Type === 'Episode') {
      var code = [item.ParentIndexNumber != null ? 'S' + item.ParentIndexNumber : '', item.IndexNumber != null ? 'E' + item.IndexNumber : ''].filter(Boolean).join(' · ');
      return [code, item.Name].filter(Boolean).join(' · ');
    }
    return item.ProductionYear ? String(item.ProductionYear) : '';
  }
  // Watched share for Continue Watching, 0 to 100, or null without a position.
  function progress(card) {
    var item = (card && card.item) || {}, data = item.UserData || {};
    var position = Number(data.PlaybackPositionTicks), length = Number(item.RunTimeTicks);
    if (!(position > 0)) return null;
    var percent = Number(data.PlayedPercentage);
    if (!Number.isFinite(percent) && length > 0) percent = position / length * 100;
    return Number.isFinite(percent) ? Math.max(2, Math.min(100, Math.round(percent))) : null;
  }
  function parseTeams(text) {
    var seen = Object.create(null), out = [];
    String(text || '').split(/[,\n]/).forEach(function (part) {
      var team = part.replace(/[\x00-\x1f]/g, '').trim().slice(0, 64), key = team.toLowerCase();
      if (team.length >= 3 && !seen[key] && out.length < 12) { seen[key] = true; out.push(team); }
    });
    return out;
  }
  function mergeTeams(displayPreferences, teams) {
    var object = displayPreferences && typeof displayPreferences === 'object' ? JSON.parse(JSON.stringify(displayPreferences)) : {};
    object.CustomPrefs = object.CustomPrefs && typeof object.CustomPrefs === 'object' ? object.CustomPrefs : {};
    object.CustomPrefs[TEAMS_KEY] = JSON.stringify(teams);
    object.Id = object.Id || TEAMS_PREFS;
    object.Client = object.Client || 'zorofin';
    return object;
  }
  function readTeams(displayPreferences) {
    try { return parseTeams(JSON.parse((displayPreferences && displayPreferences.CustomPrefs && displayPreferences.CustomPrefs[TEAMS_KEY]) || '[]').join(',')); }
    catch (_) { return []; }
  }

  function mount(root) {
    if (!root || root.zorofinPluginHomeLoaded) return;
    root.zorofinPluginHomeLoaded = true;
    var doc = root.document, TTL = 2 * 60000;
    var identity = '', generation = 0, feed = null, updated = 0, pending = false, scheduled = false;
    var rendered = '', timer = null, dialogClose = null, missing = false;

    function who() {
      try {
        var a = root.ApiClient;
        return a && a.getCurrentUserId() && a.accessToken() ? a.serverId() + ':' + a.getCurrentUserId() + ':' + a.accessToken() : '';
      } catch (_) { return ''; }
    }
    function onHome() {
      return /(?:^|[\/#])home(?:\.html)?(?:[?&]|$)/i.test(root.location.hash) &&
        !/[?&](?:tab=(?!0(?:&|$))\d+|zorofin=requests)(?:&|$)/i.test(root.location.hash);
    }
    function host() {
      if (doc.hidden || !onHome()) return null;
      var tabs = doc.querySelectorAll('.homePage #homeTab, #indexPage #homeTab');
      for (var i = tabs.length - 1; i >= 0; i--) {
        if (!tabs[i].classList.contains('hide') && tabs[i].getClientRects().length) return tabs[i].querySelector('.sections');
      }
      return null;
    }
    function node(tag, className, text) {
      var element = doc.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function url(path) {
      var a = root.ApiClient;
      return a.getUrl ? a.getUrl(path) : a.serverAddress().replace(/\/$/, '') + '/' + path;
    }
    function call(path, options) {
      options = options || {};
      var headers = { Authorization: 'MediaBrowser Token="' + root.ApiClient.accessToken() + '"' };
      if (options.body) headers['Content-Type'] = 'application/json';
      return root.fetch(url(path), {
        method: options.method || 'GET', headers: headers, cache: 'no-store', redirect: 'error',
        body: options.body ? JSON.stringify(options.body) : undefined
      }).then(function (response) {
        if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
        return response.status === 204 ? null : response.json();
      });
    }
    function detailUrl(id) {
      return '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(root.ApiClient.serverId());
    }
    function styles() {
      if (doc.getElementById('zoroPluginHomeStyles')) return;
      var style = node('style'); style.id = 'zoroPluginHomeStyles';
      // Cards reuse the theme's shelf classes (zoroBrowse*); these rules add only what they lack.
      style.textContent = [
        // Jellyfin's own sections, the Live TV section and Home Screen Sections' rows give way to the plugin's rows.
        'html.' + ON + ' #homeTab .sections{display:flex;flex-direction:column;}',
        'html.' + ON + ' #homeTab .sections>.verticalSection:not(.zoroHomeRow):not(#zoroLiveEvents):not(#zoroCollections),',
        'html.' + ON + ' #homeTab .sections>[class*="section"]:not(.verticalSection):not(.zoroHomeRow),',
        'html.' + ON + ' #homeTab #hssLoadingIndicator{display:none!important;}',
        // The plugin only draws rows that have cards. Other scripts that hide "empty" Continue Watching
        // rows count jellyfin-web's .card elements, which these rows don't use (Jellyfin Enhanced's
        // hidden-content filter does), so keep the rows shown.
        'html.' + ON + ' #homeTab .sections>.zoroHomeRow{display:block!important;}',
        '.zoroHomeRow .zoroBrowseArtwork{position:relative;overflow:hidden;border-radius:12px;}',
        '.zoroHomeRow span.zoroBrowsePoster{display:block;aspect-ratio:16/9;background:#242c29;}',
        '.zoroHomeRow .zph-badges{position:absolute;left:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;pointer-events:none;}',
        '.zoroHomeRow .zph-badge{padding:3px 8px;border-radius:999px;background:#111513d1;color:#f5f7f5;font-size:12px;line-height:1.3;font-weight:700;letter-spacing:.02em;}',
        '.zoroHomeRow .zph-context{display:block;margin-top:4px;color:var(--zoro-ui-accent,#42d779);font-size:var(--zoro-home-meta,.85em);font-weight:600;line-height:1.3;}',
        '.zoroHomeRow .zph-progress{position:absolute;left:10px;right:10px;bottom:10px;height:4px;border-radius:999px;background:#ffffff40;overflow:hidden;pointer-events:none;}',
        '.zoroHomeRow .zph-progress>span{display:block;height:100%;border-radius:inherit;background:var(--zoro-ui-accent-strong,#25b85f);}',
        '.zph-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.8);}',
        '.zph-dialog{width:min(560px,94vw);max-height:90vh;overflow:auto;padding:28px;border-radius:16px;border:1px solid rgba(255,255,255,.2);background:var(--zoro-graphite,#101411);color:#f4f8f5;}',
        '.zph-dialog h2{margin:0 0 10px;font-size:1.5em;}',
        '.zph-dialog p{margin:0 0 18px;color:#b9c5bd;}',
        '.zph-dialog label{display:block;margin-bottom:8px;font-weight:700;}',
        '.zph-dialog input{width:100%;min-height:48px;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #46554b;background:#19211c;color:#f4f8f5;font:inherit;}',
        '.zph-dialog .zph-hint{margin:8px 0 0;font-size:.88em;}',
        '.zph-dialog .zph-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;}',
        '.zph-dialog .zph-actions button{min-height:48px;padding:10px 20px;border-radius:999px;border:1px solid #46554b;background:#19211c;color:#f4f8f5;font:inherit;cursor:pointer;}',
        '.zph-dialog .zph-actions .zph-primary{background:var(--zoro-accent-strong,#25b85f);border-color:transparent;color:#04140a;font-weight:800;}',
        '.zph-dialog button:focus-visible,.zph-dialog input:focus-visible{outline:3px solid #fff;outline-offset:3px;}',
        '.zph-dialog .zph-status{min-height:1.4em;margin:10px 0 0;color:#ffb4a8;}'
      ].join('');
      doc.head.appendChild(style);
    }
    function ownRows() { return Array.prototype.slice.call(doc.querySelectorAll('section.zoroHomeRow[data-zoro-home-section]')); }
    function clearRows() {
      ownRows().forEach(function (section) { section.remove(); });
      doc.documentElement.classList.remove(ON);
      rendered = '';
    }
    function cardNode(section, card) {
      var item = card.item || {};
      var link = node('a', 'zoroBrowseCard focusable');
      link.href = detailUrl(item.Id || card.id); link.dataset.id = item.Id || card.id;
      var name = item.Type === 'Episode' && item.SeriesName ? item.SeriesName : (item.Name || 'Untitled');
      var meta = metaFor(section, card);
      link.setAttribute('aria-label', [name, meta].concat(card.badges || []).filter(Boolean).join(', '));
      var artwork = node('span', 'zoroBrowseArtwork'), image = imageFor(card);
      var art = node(image ? 'img' : 'span', 'zoroBrowsePoster');
      if (image) {
        art.alt = ''; art.width = 480; art.height = 270; art.loading = 'lazy'; art.decoding = 'async';
        var options = { type: image.type, maxWidth: 640, quality: 85 };
        if (image.tag) options.tag = image.tag;
        art.src = root.ApiClient.getImageUrl(image.id, options);
      }
      artwork.appendChild(art);
      var quality = section.id === 'showcase' ? (card.badges || []) : [];
      if (quality.length) {
        var badges = node('span', 'zph-badges');
        quality.slice(0, 3).forEach(function (badge) { badges.appendChild(node('span', 'zph-badge', badge)); });
        artwork.appendChild(badges);
      } else if (Number.isFinite(item.CommunityRating) && item.Type !== 'TvChannel') {
        var rating = node('span', 'zoroBrowseRating');
        rating.appendChild(node('span', '', '★'));
        rating.appendChild(doc.createTextNode(' ' + item.CommunityRating.toFixed(1)));
        rating.setAttribute('aria-label', 'Rating ' + item.CommunityRating.toFixed(1));
        artwork.appendChild(rating);
      }
      var watched = section.id === 'continue-watching' ? progress(card) : null;
      if (watched !== null) {
        var bar = node('span', 'zph-progress'), fill = node('span');
        fill.style.width = watched + '%'; bar.appendChild(fill); artwork.appendChild(bar);
      }
      link.appendChild(artwork);
      link.appendChild(node('strong', 'zoroBrowseTitle', name));
      if (meta) link.appendChild(node('span', 'zoroBrowseMeta', meta));
      var context = section.id === 'showcase' || section.id === 'popular' ? [] : (card.badges || []);
      if (context.length) link.appendChild(node('span', 'zph-context', context.join(' · ')));
      return link;
    }
    function trackKeys(track) {
      track.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        var current = event.target.closest && event.target.closest('.zoroBrowseCard');
        if (!current) return;
        var next = event.key === 'ArrowLeft' ? current.previousElementSibling : current.nextElementSibling;
        if (!next) return;
        event.preventDefault(); event.stopPropagation(); next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      });
    }
    function render() {
      var container = host();
      if (!container || !identity || identity !== who() || !feed) { clearRows(); return; }
      var sections = visibleSections(feed);
      // Nothing to show yet (a new server, or every row empty): keep Jellyfin's own Home.
      if (!sections.length) { clearRows(); return; }
      var signature = JSON.stringify(sections.map(function (s) { return [s.id, s.title, s.cards.map(function (c) { return c.id; })]; }));
      var existing = ownRows();
      if (existing.length === sections.length && signature === rendered && existing.every(function (row) { return row.parentNode === container; })) return;
      var active = doc.activeElement, focusId = active && active.closest && active.closest('.zoroHomeRow') ? active.getAttribute('href') : null;
      ownRows().forEach(function (row) { row.remove(); });
      styles();
      var rows = sections.map(function (section, index) {
        var row = node('section', 'zoroBrowseRow verticalSection zoroHomeRow');
        row.id = elementId(section); row.setAttribute('aria-labelledby', row.id + '-title');
        row.setAttribute('data-zoro-home-section', section.id);
        row.setAttribute('data-zoro-placement', section.placement);
        // zorofin-home-layout.js pins this row first and keeps one card per show.
        if (section.id === 'continue-watching') row.classList.add('ContinueWatchingNextUp');
        row.style.order = String(index + 1);
        var bar = node('div', 'sectionTitleContainer sectionTitleContainer-cards');
        var title = node('h2', 'sectionTitle sectionTitle-cards', section.title);
        title.id = row.id + '-title'; bar.appendChild(title); row.appendChild(bar);
        var track = node('div', 'zoroBrowseTrack focuscontainer-x');
        section.cards.slice(0, 20).forEach(function (card) { track.appendChild(cardNode(section, card)); });
        trackKeys(track); row.appendChild(track);
        return row;
      });
      var first = container.firstChild;
      rows.forEach(function (row) { container.insertBefore(row, first); });
      doc.documentElement.classList.add(ON);
      rendered = signature;
      if (focusId) {
        var links = doc.querySelectorAll('.zoroHomeRow a');
        for (var i = 0; i < links.length; i++) if (links[i].getAttribute('href') === focusId) { links[i].focus({ preventScroll: true }); break; }
      }
    }
    function load(force) {
      if (pending || missing || (!force && feed && Date.now() - updated < TTL)) return;
      pending = true;
      var epoch = generation, source = identity;
      call('Zorofin/Home/Sections' + (force ? '?fresh=true' : '')).then(function (data) {
        if (epoch !== generation || source !== who()) return;
        if (!data || data.schemaVersion !== 1) throw new Error('unsupported');
        feed = data; updated = Date.now(); render();
      }).catch(function (error) {
        if (epoch !== generation) return;
        // No plugin Home on this server (or it was switched off): Jellyfin's own Home stays.
        if (error && error.status === 404) missing = true;
        if (error && (error.status === 401 || error.status === 404)) { feed = null; clearRows(); }
        // Any other failure keeps the last rows, or Jellyfin's own Home when there are none.
      }).then(function () { if (epoch === generation) pending = false; });
    }
    function refresh(force) {
      var current = who();
      if (current !== identity) { identity = current; generation++; feed = null; updated = 0; pending = false; missing = false; clearRows(); }
      clearTimeout(timer); timer = null;
      if (!identity || !host()) { if (!host()) doc.documentElement.classList.remove(ON); return; }
      render(); load(force);
      timer = setTimeout(function () { refresh(false); }, TTL);
    }
    function schedule() {
      if (scheduled) return; scheduled = true;
      setTimeout(function () { scheduled = false; refresh(false); }, 120);
    }

    // "Your teams", from the avatar menu like the apps' profile page. Teams live in
    // Jellyfin's display preferences, so the apps on any server see the same list.
    function teamsPath() {
      return 'DisplayPreferences/' + TEAMS_PREFS + '?userId=' + encodeURIComponent(root.ApiClient.getCurrentUserId()) + '&client=zorofin';
    }
    function openTeams(trigger) {
      if (dialogClose || !who()) return;
      styles();
      var overlay = node('div', 'zph-overlay'), dialog = node('div', 'zph-dialog');
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'zphDialogTitle');
      var title = node('h2', '', 'See your teams on Home'); title.id = 'zphDialogTitle'; dialog.appendChild(title);
      dialog.appendChild(node('p', '', 'Follow teams to personalize upcoming sports. Everything else on Home is selected automatically.'));
      var label = node('label', '', 'Your teams'); label.htmlFor = 'zphTeams';
      var teams = node('input'); teams.type = 'text'; teams.id = 'zphTeams'; teams.setAttribute('autocomplete', 'off');
      teams.placeholder = 'New York Knicks, New York Yankees'; teams.disabled = true;
      dialog.appendChild(label); dialog.appendChild(teams);
      dialog.appendChild(node('p', 'zph-hint', 'Use full team names as they appear in the guide, separated by commas. Up to 12 teams. Leave blank to see all upcoming sports.'));
      var status = node('p', 'zph-status'); status.setAttribute('role', 'status'); dialog.appendChild(status);
      var actions = node('div', 'zph-actions');
      var cancel = node('button', '', 'Cancel'); cancel.type = 'button';
      var save = node('button', 'zph-primary', 'Save'); save.type = 'button'; save.disabled = true;
      actions.appendChild(cancel); actions.appendChild(save); dialog.appendChild(actions);
      overlay.appendChild(dialog); doc.body.appendChild(overlay);
      var current = {};

      function close() {
        overlay.remove(); doc.removeEventListener('keydown', keys, true); dialogClose = null;
        if (trigger && trigger.isConnected) trigger.focus();
      }
      function keys(event) {
        if (event.key === 'Escape' || event.key === 'GoBack' || event.keyCode === 461) { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.key !== 'Tab') return;
        var items = Array.prototype.slice.call(dialog.querySelectorAll('input:not([disabled]),button:not([disabled])'));
        var at = items.indexOf(doc.activeElement);
        if (event.shiftKey && at <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
        else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0].focus(); }
      }
      call(teamsPath()).catch(function (error) { if (error && error.status === 404) return {}; throw error; }).then(function (prefs) {
        current = prefs || {};
        teams.value = readTeams(current).join(', '); teams.disabled = false; save.disabled = false; teams.focus();
      }).catch(function () { status.textContent = 'Your teams could not be loaded. Try again shortly.'; });
      cancel.addEventListener('click', close);
      overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
      save.addEventListener('click', function () {
        save.disabled = true; status.textContent = '';
        call(teamsPath(), { method: 'POST', body: mergeTeams(current, parseTeams(teams.value)) }).then(function () {
          close(); updated = 0; load(true);
        }).catch(function () {
          save.disabled = false; status.textContent = 'Your teams could not be saved. Try again.';
        });
      });
      doc.addEventListener('keydown', keys, true);
      dialogClose = close;
      cancel.focus();
    }
    // Another Home script (the reference server's) may already offer teams; keep its dialog.
    if (typeof root.zorofinOpenTeams !== 'function') root.zorofinOpenTeams = openTeams;

    root.addEventListener('hashchange', schedule);
    root.addEventListener('focus', function () { refresh(false); });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) refresh(false); });
    new root.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    schedule();
  }

  return {
    mount: mount, visibleSections: visibleSections, elementId: elementId, imageFor: imageFor,
    metaFor: metaFor, progress: progress, parseTeams: parseTeams, mergeTeams: mergeTeams, readTeams: readTeams
  };
}));
