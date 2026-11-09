/* Zorofin Calendar and Catch Up pages, from the Zorofin plugin's extras, in
 * place of Jellyfin Enhanced's. Each opens as a full page under the header
 * (Back closes it) from the account menu, the side menu and the phone Profile
 * page, and only when the server has it on.
 *
 * Calendar: upcoming episodes and movie releases from Sonarr and Radarr, as an
 * agenda (the default) or a month grid, filterable by shows and movies.
 * Catch Up: one unwatched title at a time. Play, Watch later (the viewer's
 * watchlist, Jellyfin's "liked" flag), Mark watched, or Skip. Arrow keys and
 * swipes work too. Skips stay in this browser. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var PAGES = { calendar: { label: 'Calendar', icon: 'calendar_month' }, catchup: { label: 'Catch Up', icon: 'style' } };
  var RELEASE = { airing: 'New episode', cinema: 'In cinemas', digital: 'Digital release', physical: 'On disc' };

  // ---- Pure helpers (tested) ----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  // The local day an event falls on: episodes by their air time, movie releases by their date.
  function eventDay(event) {
    if (event.allDay) return String(event.at).slice(0, 10);
    var d = new Date(event.at);
    return isNaN(d) ? '' : dayKey(d);
  }
  function groupByDay(events, filter) {
    var groups = {}, order = [];
    (events || []).forEach(function (e) {
      if (filter === 'shows' && e.kind !== 'episode') return;
      if (filter === 'movies' && e.kind !== 'movie') return;
      var key = eventDay(e);
      if (!key) return;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(e);
    });
    order.sort();
    return order.map(function (key) { return { day: key, events: groups[key] }; });
  }
  // Month grid: weeks starting Monday, covering the whole month.
  function monthGrid(year, month) {
    var first = new Date(year, month, 1), start = new Date(year, month, 1 - ((first.getDay() + 6) % 7)), weeks = [];
    for (var w = 0; w < 6; w++) {
      var week = [];
      for (var i = 0; i < 7; i++) { var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i); week.push({ key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month }); }
      if (w > 3 && !week.some(function (x) { return x.inMonth; })) break;
      weeks.push(week);
    }
    return weeks;
  }
  function dayLabel(key, today) {
    var parts = key.split('-'), d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var t = today || new Date(), tk = dayKey(t), tomorrow = dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
    var name = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return key === tk ? 'Today · ' + name : key === tomorrow ? 'Tomorrow · ' + name : name;
  }
  // Skipped Catch Up titles, per account, in this browser only.
  function skipStore(storage, account) {
    var key = 'zorofin-catchup-skips:' + account;
    function read() { try { var v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
    return {
      has: function (id) { return read().indexOf(id) >= 0; },
      add: function (id) { var list = read().filter(function (x) { return x !== id; }); list.push(id); try { storage.setItem(key, JSON.stringify(list.slice(-500))); } catch (_) { /* full or private */ } },
      clear: function () { try { storage.removeItem(key); } catch (_) { /* private */ } }
    };
  }

  function mount() {
    if (root.ZorofinExtraPages) return;
    var doc = root.document;
    var state = { page: null, el: null, extras: null, generation: 0 };
    root.ZorofinExtraPages = { open: open, close: close, version: '1.0.0' };

    function client() { return root.ApiClient; }
    function account() { try { var c = client(); return c.serverId() + ':' + c.getCurrentUserId(); } catch (_) { return ''; } }
    function make(tag, cls, text) { var el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
    function icon(name) { var i = make('span', 'material-icons', name); i.setAttribute('aria-hidden', 'true'); return i; }
    function button(text, cls, onClick, iconName) { var b = make('button', cls || 'zx-button'); b.type = 'button'; if (iconName) b.appendChild(icon(iconName)); if (text) b.appendChild(make('span', '', text)); if (onClick) b.addEventListener('click', onClick); return b; }
    function extras() { return root.ZorofinExtras ? root.ZorofinExtras.get() : Promise.resolve(null); }
    function pageOn(ex, page) { return Boolean(ex && (page === 'calendar' ? ex.calendar : ex.catchUp)); }
    function details(id) { var c = client(); close(); root.location.hash = '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(c.serverId()); }
    function headerBottom() {
      // The Zorofin shell publishes its header height; Jellyfin's own header otherwise.
      var shell = parseFloat(root.getComputedStyle(doc.documentElement).getPropertyValue('--zoro-shell-header'));
      var h = doc.querySelector('.skinHeader:not(.hide)'), b = h ? Math.ceil(h.getBoundingClientRect().bottom) : 0;
      return Math.max(0, isFinite(shell) ? shell : 0, b) + 'px';
    }

    // ---- Page frame ----
    function open(page, replace) {
      if (!PAGES[page]) return;
      extras().then(function (ex) {
        state.extras = ex;
        if (!pageOn(ex, page)) return;
        if (!/[?&]zorofin=/.test(root.location.hash) || replace) {
          root.history[replace ? 'replaceState' : 'pushState']({ zorofinPage: page }, '', '#/home?zorofin=' + page);
        }
        show(page);
      });
    }
    function show(page) {
      var gen = ++state.generation;
      if (state.el) state.el.remove();
      state.page = page;
      var el = make('section', 'zxPage'); el.id = 'zoroExtrasPage'; el.dataset.page = page;
      el.setAttribute('role', 'region'); el.setAttribute('aria-label', PAGES[page].label); el.tabIndex = -1;
      el.style.setProperty('--zx-top', headerBottom());
      var head = make('div', 'zx-head'), title = make('h1', 'zx-title', PAGES[page].label);
      var closeBtn = button('', 'zx-icon-button zx-close', function () { root.history.back(); }, 'close'); closeBtn.setAttribute('aria-label', 'Close ' + PAGES[page].label);
      head.append(title, closeBtn);
      var body = make('div', 'zx-body');
      el.append(head, body);
      doc.body.appendChild(el);
      doc.documentElement.classList.add('zoro-extras-page-open');
      state.el = el;
      el.focus({ preventScroll: true });
      (page === 'calendar' ? calendar : catchUp)(body, gen);
    }
    function close() {
      state.generation++;
      if (state.el) state.el.remove();
      state.el = null; state.page = null;
      doc.documentElement.classList.remove('zoro-extras-page-open');
    }
    function sync() {
      var m = /^#\/home\?(?:.*&)?zorofin=(calendar|catchup)(?:&|$)/.exec(root.location.hash);
      if (m && state.page !== m[1]) open(m[1], true);
      else if (!m && state.el) close();
    }
    function live(gen) { return gen === state.generation && state.el; }
    function empty(body, title, text) { var box = make('div', 'zx-empty'); box.append(make('h2', '', title), make('p', 'zx-muted', text)); body.appendChild(box); }
    function loading(body) { body.replaceChildren(make('p', 'zx-muted zx-loading', 'Loading…')); }

    // ---- Calendar ----
    function calendar(body, gen) {
      var view = 'agenda', filter = 'all', cursor = new Date(), data = {};
      var tools = make('div', 'zx-tools'), views = make('div', 'zx-segment'), filters = make('div', 'zx-segment'), nav = make('div', 'zx-month-nav');
      views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'View');
      filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Show');
      [['agenda', 'Agenda'], ['month', 'Month']].forEach(function (v) { var b = button(v[1], 'zx-chip', function () { view = v[0]; draw(); }); b.dataset.value = v[0]; views.appendChild(b); });
      [['all', 'Everything'], ['shows', 'Shows'], ['movies', 'Movies']].forEach(function (v) { var b = button(v[1], 'zx-chip', function () { filter = v[0]; draw(); }); b.dataset.value = v[0]; filters.appendChild(b); });
      var prev = button('', 'zx-icon-button', function () { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); draw(); }, 'chevron_left'); prev.setAttribute('aria-label', 'Previous month');
      var next = button('', 'zx-icon-button', function () { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); draw(); }, 'chevron_right'); next.setAttribute('aria-label', 'Next month');
      var month = make('h2', 'zx-month');
      nav.append(prev, month, next);
      tools.append(views, filters, nav);
      var out = make('div', 'zx-calendar');
      body.append(tools, out);

      function fetchRange(start, days) {
        var key = dayKey(start) + '/' + days;
        if (!data[key]) data[key] = root.ZorofinExtras.api('Zorofin/Arr/Calendar?start=' + dayKey(start) + '&days=' + days).then(function (r) { return (r && r.items) || []; });
        return data[key];
      }
      function mark(group, value) { group.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.value === value)); }); }
      function row(e) {
        var item = make(e.itemId ? 'button' : 'div', 'zx-event'); if (e.itemId) { item.type = 'button'; item.addEventListener('click', function () { details(e.itemId); }); }
        var art = make('div', 'zx-event-art');
        if (e.posterUrl) { var img = make('img'); img.src = e.posterUrl; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', function () { this.remove(); }); art.appendChild(img); }
        var text = make('div', 'zx-event-text');
        text.appendChild(make('strong', 'zx-event-title', e.title));
        if (e.subtitle) text.appendChild(make('span', 'zx-muted', e.subtitle));
        var meta = make('span', 'zx-event-meta');
        if (!e.allDay) { var t = new Date(e.at); meta.appendChild(make('span', '', t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))); }
        var badge = make('span', 'zx-badge', e.premiere ? (e.subtitle && /^S1:E1\b/.test(e.subtitle) ? 'Series premiere' : 'Season premiere') : RELEASE[e.release] || '');
        badge.dataset.tone = e.premiere ? 'accent' : e.release;
        if (badge.textContent) meta.appendChild(badge);
        if (e.hasFile) meta.appendChild(make('span', 'zx-badge', 'On the server')).dataset.tone = 'ok';
        if (e.network) meta.appendChild(make('span', 'zx-muted', e.network));
        text.appendChild(meta);
        item.append(art, text);
        return item;
      }
      function draw() {
        mark(views, view); mark(filters, filter);
        nav.hidden = view !== 'month';
        loading(out);
        var start, days;
        if (view === 'agenda') { var t = new Date(); start = new Date(t.getFullYear(), t.getMonth(), t.getDate()); days = 28; }
        else { var grid = monthGrid(cursor.getFullYear(), cursor.getMonth()), first = grid[0][0].key.split('-'); start = new Date(Number(first[0]), Number(first[1]) - 1, Number(first[2])); days = grid.length * 7; month.textContent = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
        fetchRange(start, days).then(function (events) {
          if (!live(gen)) return;
          out.replaceChildren();
          var groups = groupByDay(events, filter);
          if (view === 'agenda') {
            var today = dayKey(new Date());
            groups = groups.filter(function (g) { return g.day >= today; });
            if (!groups.length) { empty(out, 'Nothing coming up', filter === 'all' ? 'New episodes and movie releases from the next four weeks show here.' : 'Try Everything to see the rest.'); return; }
            groups.forEach(function (g) {
              var section = make('section', 'zx-day'); section.appendChild(make('h2', 'zx-day-title', dayLabel(g.day)));
              var list = make('div', 'zx-day-list'); g.events.forEach(function (e) { list.appendChild(row(e)); });
              section.appendChild(list); out.appendChild(section);
            });
          } else {
            var byDay = {}; groups.forEach(function (g) { byDay[g.day] = g.events; });
            var table = make('div', 'zx-grid'); table.setAttribute('role', 'grid'); table.setAttribute('aria-label', month.textContent);
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { table.appendChild(make('div', 'zx-grid-head', d)).setAttribute('role', 'columnheader'); });
            var todayKey = dayKey(new Date());
            monthGrid(cursor.getFullYear(), cursor.getMonth()).forEach(function (week) {
              week.forEach(function (cell) {
                var c = make('div', 'zx-cell' + (cell.inMonth ? '' : ' zx-out') + (cell.key === todayKey ? ' zx-today' : '')); c.setAttribute('role', 'gridcell');
                c.appendChild(make('span', 'zx-cell-day', String(cell.day)));
                (byDay[cell.key] || []).slice(0, 4).forEach(function (e) {
                  var chip = make(e.itemId ? 'button' : 'span', 'zx-cell-event', e.title + (e.subtitle && e.kind === 'episode' ? ' · ' + e.subtitle.split(' · ')[0] : ''));
                  chip.dataset.kind = e.kind; chip.title = e.title + (e.subtitle ? ' · ' + e.subtitle : '');
                  if (e.itemId) { chip.type = 'button'; chip.addEventListener('click', function () { details(e.itemId); }); }
                  c.appendChild(chip);
                });
                var more = (byDay[cell.key] || []).length - 4; if (more > 0) c.appendChild(make('span', 'zx-muted zx-more', '+' + more + ' more'));
                table.appendChild(c);
              });
            });
            out.appendChild(table);
          }
        }, function () { if (live(gen)) { out.replaceChildren(); empty(out, 'Couldn’t load the calendar', 'Sonarr or Radarr didn’t answer. Try again in a moment.'); } });
      }
      draw();
    }

    // ---- Catch Up ----
    function catchUp(body, gen) {
      var c = client(), skips = skipStore(root.localStorage, account()), queue = [], index = 0, kind = 'Movie,Series', busy = false;
      var tools = make('div', 'zx-tools'), kinds = make('div', 'zx-segment');
      kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Show');
      [['Movie,Series', 'Everything'], ['Movie', 'Movies'], ['Series', 'Shows']].forEach(function (v) { var b = button(v[1], 'zx-chip', function () { kind = v[0]; load(); }); b.dataset.value = v[0]; kinds.appendChild(b); });
      var reset = button('Show skipped again', 'zx-button zx-quiet', function () { skips.clear(); load(); });
      tools.append(kinds, reset);
      var stage = make('div', 'zx-catchup'); stage.setAttribute('aria-live', 'polite');
      var hint = make('p', 'zx-muted zx-hint', 'Use ← to skip, → to play, ↑ for later and ↓ when you’ve seen it.');
      body.append(tools, stage, hint);

      function log(item, action) {
        if (root.ZorofinExtras) root.ZorofinExtras.api('Zorofin/Extras/CatchUp/Log', { method: 'POST', body: { itemId: item.Id, action: action } }).then(null, function () { /* the log is best-effort */ });
      }
      function load() {
        kinds.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.value === kind)); });
        loading(stage);
        c.getItems(c.getCurrentUserId(), {
          IncludeItemTypes: kind, Recursive: true, IsPlayed: false, SortBy: 'Random', Limit: 60, HasOverview: true,
          Fields: 'Overview,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,BackdropImageTags,ImageTags,UserData,Genres',
          ImageTypeLimit: 1, EnableImageTypes: 'Backdrop,Logo,Primary', ExcludeLocationTypes: 'Virtual'
        }).then(function (r) {
          if (!live(gen)) return;
          queue = ((r && r.Items) || []).filter(function (i) { return !skips.has(i.Id) && !(i.UserData && i.UserData.Likes); });
          index = 0; draw();
        }, function () { if (live(gen)) { stage.replaceChildren(); empty(stage, 'Couldn’t load titles', 'Try again in a moment.'); } });
      }
      function draw() {
        stage.replaceChildren();
        var item = queue[index];
        if (!item) { empty(stage, 'You’re all caught up', 'Nothing unwatched left here. Try another filter, or show skipped titles again.'); return; }
        var cardEl = make('article', 'zx-card'); cardEl.setAttribute('aria-label', item.Name);
        var art = make('div', 'zx-card-art');
        if (item.BackdropImageTags && item.BackdropImageTags.length) { var img = make('img'); img.alt = ''; img.src = c.getImageUrl(item.Id, { type: 'Backdrop', tag: item.BackdropImageTags[0], maxWidth: 1280, quality: 85 }); art.appendChild(img); }
        var info = make('div', 'zx-card-info');
        if (item.ImageTags && item.ImageTags.Logo) { var logo = make('img', 'zx-card-logo'); logo.alt = item.Name; logo.src = c.getImageUrl(item.Id, { type: 'Logo', tag: item.ImageTags.Logo, maxWidth: 600 }); info.appendChild(logo); }
        else info.appendChild(make('h2', 'zx-card-title', item.Name));
        var meta = [item.ProductionYear, item.Type === 'Series' && item.ChildCount ? item.ChildCount + (item.ChildCount === 1 ? ' season' : ' seasons') : null, item.OfficialRating, item.CommunityRating ? '★ ' + Number(item.CommunityRating).toFixed(1) : null].filter(Boolean);
        info.appendChild(make('p', 'zx-muted', meta.join(' · ')));
        info.appendChild(make('p', 'zx-card-plot', item.Overview || ''));
        var actions = make('div', 'zx-card-actions');
        var skip = button('Skip', 'zx-button', function () { act('skip'); }, 'close');
        var later = button('Watch later', 'zx-button', function () { act('later'); }, 'bookmark_add');
        var seen = button('Seen it', 'zx-button', function () { act('watched'); }, 'done');
        var play = button('Play', 'zx-button zx-primary', function () { act('watch'); }, 'play_arrow');
        actions.append(skip, later, seen, play);
        info.appendChild(actions);
        cardEl.append(art, info);
        stage.appendChild(cardEl);
        stage.appendChild(make('p', 'zx-muted zx-count', (index + 1) + ' of ' + queue.length));
        var startX = null;
        cardEl.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
        cardEl.addEventListener('touchend', function (e) { if (startX == null) return; var dx = e.changedTouches[0].clientX - startX; startX = null; if (Math.abs(dx) > 60) act(dx < 0 ? 'skip' : 'later'); });
        play.focus({ preventScroll: true });
      }
      function act(action) {
        var item = queue[index];
        if (!item || busy) return;
        busy = true;
        log(item, action);
        var done = function () { busy = false; if (action !== 'watch' && live(gen)) { index++; draw(); } };
        if (action === 'skip') { skips.add(item.Id); done(); }
        else if (action === 'later') Promise.resolve(c.updateUserItemRating(c.getCurrentUserId(), item.Id, true)).then(done, done);
        else if (action === 'watched') Promise.resolve(c.markPlayed(c.getCurrentUserId(), item.Id, new Date())).then(done, done);
        else { busy = false; details(item.Id); }
      }
      body.addEventListener('keydown', function (e) {
        if (e.target.closest('.zx-tools')) return;
        var map = { ArrowLeft: 'skip', ArrowRight: 'watch', ArrowUp: 'later', ArrowDown: 'watched' };
        if (map[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); act(map[e.key]); }
      });
      load();
    }

    // ---- Entry points ----
    function addEntries() {
      extras().then(function (ex) {
        state.extras = ex;
        var on = Object.keys(PAGES).filter(function (p) { return pageOn(ex, p); });
        // Side menu.
        var drawer = doc.querySelector('.mainDrawer-scrollContainer');
        if (drawer) {
          Object.keys(PAGES).forEach(function (p) {
            var link = drawer.querySelector('[data-zoro-page="' + p + '"]');
            if (on.indexOf(p) < 0) { if (link) link.remove(); return; }
            if (link) return;
            link = make('a', 'navMenuOption emby-button focusable'); link.href = '#/home?zorofin=' + p; link.dataset.zoroPage = p;
            var i = make('span', 'material-icons navMenuOptionIcon', PAGES[p].icon); i.setAttribute('aria-hidden', 'true');
            link.append(i, make('span', 'navMenuOptionText', PAGES[p].label));
            link.addEventListener('click', function (e) { e.preventDefault(); open(p); });
            drawer.appendChild(link);
          });
        }
        // Phone Profile page only: wide screens and TVs already reach these pages
        // from the side menu and the account menu, so Settings stays settings.
        var phone = root.innerWidth <= 599 && !doc.documentElement.classList.contains('layout-tv') && !doc.body.classList.contains('layout-tv');
        var profile = /^#\/mypreferencesmenu/.test(root.location.hash) && doc.querySelector('.libraryPage:not(.hide) .verticalSection, .page:not(.hide) .readOnlyContent');
        if (profile && !phone) Array.prototype.forEach.call(profile.querySelectorAll('.zx-profile-link'), function (a) { a.remove(); });
        if (profile && phone && on.length && !profile.querySelector('[data-zoro-page]')) {
          on.forEach(function (p) {
            var a = make('a', 'listItem-border emby-button zx-profile-link'); a.href = '#/home?zorofin=' + p; a.dataset.zoroPage = p;
            var row = make('div', 'listItem'); var i = make('span', 'material-icons listItemIcon listItemIcon-transparent', PAGES[p].icon); i.setAttribute('aria-hidden', 'true');
            var t = make('div', 'listItemBody'); t.appendChild(make('div', 'listItemBodyText', PAGES[p].label)); row.append(i, t); a.appendChild(row);
            a.addEventListener('click', function (e) { e.preventDefault(); open(p); });
            profile.insertBefore(a, profile.firstChild);
          });
        }
      });
    }
    // Account menu (zorofin-account-menu.js) reads this list.
    root.ZorofinMenuExtras = function () {
      var ex = state.extras;
      return Object.keys(PAGES).filter(function (p) { return pageOn(ex, p); }).map(function (p) { return { key: 'page-' + p, label: PAGES[p].label, run: function () { open(p); } }; });
    };

    var queued = false;
    function schedule() { if (queued) return; queued = true; root.requestAnimationFrame(function () { queued = false; addEntries(); }); }
    root.addEventListener('hashchange', function () { sync(); schedule(); });
    root.addEventListener('popstate', sync);
    doc.addEventListener('viewshow', schedule);
    doc.addEventListener('keydown', function (e) { if (state.el && (e.key === 'Escape' || e.keyCode === 461) && !doc.querySelector('.dialogContainer')) { e.preventDefault(); root.history.back(); } });
    root.addEventListener('resize', function () { if (state.el) state.el.style.setProperty('--zx-top', headerBottom()); schedule(); });
    new MutationObserver(function (records) { if (records.some(function (r) { return r.addedNodes.length; })) schedule(); }).observe(doc.body, { childList: true, subtree: false });
    root.setTimeout(function () { sync(); schedule(); }, 800);
  }

  return { mount: mount, groupByDay: groupByDay, monthGrid: monthGrid, eventDay: eventDay, dayKey: dayKey, skipStore: skipStore, dayLabel: dayLabel };
}));
