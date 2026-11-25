/* Zorofin Calendar and Catch Up pages, from the Zorofin plugin's extras, in
 * place of Jellyfin Enhanced's. Each opens as a full page under the header
 * (Back closes it) from the account menu, the side menu and the phone Profile
 * page, and only when the server has it on.
 *
 * Calendar: upcoming episodes and movie releases from Sonarr and Radarr, as an
 * agenda (the default) or a month grid, filterable by shows and movies.
 * Catch Up: swipe left to skip, right to like for recommendations. Watched
 * state, favorites and watchlists are untouched. Matching buttons and arrow keys work too. Skips stay in this browser.
 * Catch Up → Together (Pick Together): a group swipes on their own phones and
 * sees the titles everyone liked, when the companion's pickTogether module is on. */
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

  // QR code for the Pick Together invite link: byte mode, error correction M,
  // versions 1-9 (links up to about 180 characters). Returns rows of booleans
  // (true = dark), or null when the text is too long.
  function qrMatrix(text) {
    var bytes = [], i, s = unescape(encodeURIComponent(String(text)));
    for (i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    var ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22], BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5];
    function rawModules(v) { var r = (16 * v + 128) * v + 64; if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; }
    function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v]; }
    var ver = 0;
    for (var v = 1; v <= 9; v++) if (4 + 8 + bytes.length * 8 <= dataCodewords(v) * 8) { ver = v; break; }
    if (!ver) return null;
    var bits = [];
    function put(value, len) { for (var b = len - 1; b >= 0; b--) bits.push((value >>> b) & 1); }
    put(4, 4); put(bytes.length, 8); bytes.forEach(function (x) { put(x, 8); });
    var capacity = dataCodewords(ver) * 8;
    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var byte = 0; for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k]; data.push(byte); }
    // Reed-Solomon error correction, then interleave the blocks.
    function mul(x, y) { var z = 0; for (var b = 7; b >= 0; b--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> b) & 1) * x; } return z; }
    var degree = ECC[ver], divisor = [], root = 1;
    for (i = 0; i < degree - 1; i++) divisor.push(0);
    divisor.push(1);
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < divisor.length; j++) { divisor[j] = mul(divisor[j], root); if (j + 1 < divisor.length) divisor[j] ^= divisor[j + 1]; }
      root = mul(root, 2);
    }
    function remainder(block) {
      var result = divisor.map(function () { return 0; });
      block.forEach(function (b) { var factor = b ^ result.shift(); result.push(0); divisor.forEach(function (c, n) { result[n] ^= mul(c, factor); }); });
      return result;
    }
    var numBlocks = BLOCKS[ver], raw = Math.floor(rawModules(ver) / 8), shortCount = numBlocks - raw % numBlocks, shortLen = Math.floor(raw / numBlocks);
    var blocks = [], offset = 0;
    for (i = 0; i < numBlocks; i++) {
      var dat = data.slice(offset, offset + shortLen - degree + (i < shortCount ? 0 : 1));
      offset += dat.length;
      var block = dat.concat(remainder(dat));
      if (i < shortCount) block.splice(shortLen - degree, 0, 0);
      blocks.push(block);
    }
    var codewords = [];
    for (i = 0; i < blocks[0].length; i++) blocks.forEach(function (block, n) { if (i !== shortLen - degree || n >= shortCount) codewords.push(block[i]); });
    // Function patterns.
    var size = ver * 4 + 17, m = [], fn = [];
    for (i = 0; i < size; i++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function set(x, y, dark) { m[y][x] = dark; fn[y][x] = true; }
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (p) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = p[0] + dx, yy = p[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
    });
    var align = [];
    if (ver > 1) {
      var count = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
      align = [6];
      for (var pos = size - 7; align.length < count; pos -= step) align.splice(1, 0, pos);
    }
    align.forEach(function (ay, a) {
      align.forEach(function (ax, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === align.length - 1) || (a === align.length - 1 && b === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function format(mask) {
      var value = mask, rem = value; // error correction M = 0b00
      for (var n = 0; n < 10; n++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var f = ((value << 10) | rem) ^ 0x5412, bit = function (n) { return ((f >>> n) & 1) === 1; };
      for (n = 0; n <= 5; n++) set(8, n, bit(n));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (n = 9; n < 15; n++) set(14 - n, 8, bit(n));
      for (n = 0; n < 8; n++) set(size - 1 - n, 8, bit(n));
      for (n = 8; n < 15; n++) set(8, size - 15 + n, bit(n));
      set(8, size - 8, true);
    }
    format(0);
    if (ver >= 7) {
      var vr = ver;
      for (i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vbits = (ver << 12) | vr;
      for (i = 0; i < 18; i++) { var on = ((vbits >>> i) & 1) === 1, a1 = size - 11 + i % 3, b1 = Math.floor(i / 3); set(a1, b1, on); set(b1, a1, on); }
    }
    // Data, in the zigzag order.
    var bit = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var c = 0; c < 2; c++) {
        var x = right - c, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bit < codewords.length * 8) { m[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1; bit++; }
      }
    }
    var masks = [
      function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
      function (x) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; }, function (x, y) { return x * y % 2 + x * y % 3 === 0; },
      function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; }, function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
    ];
    function applyMask(k) { for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && masks[k](xx, yy)) m[yy][xx] = !m[yy][xx]; }
    // Simplified penalty: long runs, 2x2 blocks and dark balance.
    function penalty() {
      var score = 0, dark = 0, yy, xx;
      for (yy = 0; yy < size; yy++) {
        var runRow = 1, runCol = 1;
        for (xx = 0; xx < size; xx++) {
          if (m[yy][xx]) dark++;
          if (xx > 0) { if (m[yy][xx] === m[yy][xx - 1]) { runRow++; if (runRow === 5) score += 3; else if (runRow > 5) score++; } else runRow = 1; }
          if (xx > 0) { if (m[xx][yy] === m[xx - 1][yy]) { runCol++; if (runCol === 5) score += 3; else if (runCol > 5) score++; } else runCol = 1; }
          if (xx > 0 && yy > 0 && m[yy][xx] === m[yy - 1][xx] && m[yy][xx] === m[yy][xx - 1] && m[yy][xx] === m[yy - 1][xx - 1]) score += 3;
        }
      }
      return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    }
    var best = 0, bestScore = Infinity;
    for (var k = 0; k < 8; k++) { applyMask(k); format(k); var p = penalty(); if (p < bestScore) { best = k; bestScore = p; } applyMask(k); }
    applyMask(best); format(best);
    return m;
  }

  function mount() {
    if (root.ZorofinExtraPages) return;
    var doc = root.document;
    var state = { page: null, el: null, extras: null, generation: 0 };
    root.ZorofinExtraPages = { open: open, close: close, version: '1.3.0' };

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
      if (page !== 'catchup') { calendar(body, gen); return; }
      // Catch Up: Just me (solo taste) or Together (Pick Together), when the
      // server's companion offers it. A join link opens Together directly.
      var params = new URLSearchParams(String(root.location.hash).split('?')[1] || '');
      var joinCode = params.get('pick'), wantsTogether = Boolean(joinCode) || params.get('together') === '1';
      var modes = make('div', 'zx-segment zp-mode'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Catch Up mode'); modes.hidden = true;
      function run(mode, code) {
        var fresh = make('div', 'zx-body'); el.replaceChild(fresh, body); body = fresh;
        delete el.dataset.zpView;
        var g = ++state.generation;
        Array.prototype.forEach.call(modes.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
        root.history.replaceState(root.history.state, '', '#/home?zorofin=catchup' + (mode === 'together' ? '&together=1' : ''));
        if (mode === 'together') together(fresh, g, code); else catchUp(fresh, g);
      }
      [['solo', 'Just me'], ['together', 'Together']].forEach(function (m) {
        var b = button(m[1], 'zx-chip', function () { if (b.getAttribute('aria-pressed') !== 'true') run(m[0]); }); b.dataset.mode = m[0]; modes.appendChild(b);
      });
      head.insertBefore(modes, closeBtn);
      if (wantsTogether) loading(body); else catchUp(body, gen);
      Array.prototype.forEach.call(modes.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === (wantsTogether ? 'together' : 'solo'))); });
      pickAvailable().then(function (on) {
        if (state.el !== el) return;
        modes.hidden = !on;
        if (wantsTogether) { if (on) run('together', joinCode); else run('solo'); }
      });
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

    // Shared by Catch Up and Pick Together. hooks.blocked() pauses input while
    // saving; hooks.commit(action) receives 'like' or 'skip'.
    function bindSwipe(card, stamp, hooks) {
      var start = null, axis = null, pointer = null, frame = null, animation = null, dx = 0, sign = 0, samples = [];
      var reduced = root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function transform(x) { return 'translate3d(' + x + 'px,0,0) rotate(' + (reduced ? 0 : Math.max(-12, Math.min(12, x / 30))) + 'deg)'; }
      function paint() {
        frame = null;
        card.style.transform = transform(dx);
        var direction = dx > 0 ? 1 : -1;
        if (direction !== sign) { sign = direction; stamp.textContent = sign > 0 ? 'LIKE' : 'SKIP'; stamp.dataset.action = sign > 0 ? 'like' : 'skip'; }
        stamp.style.opacity = String(Math.min(1, Math.abs(dx) / 80));
      }
      function flush() { if (frame != null) root.cancelAnimationFrame(frame); paint(); }
      function animateTo(x, duration) {
        if (frame != null) { root.cancelAnimationFrame(frame); frame = null; }
        var from = root.getComputedStyle(card).transform;
        if (animation) { animation.cancel(); animation = null; }
        var target = transform(x); dx = x;
        card.classList.remove('zx-dragging'); card.classList.add('zx-moving');
        card.style.transform = target;
        if (reduced || !card.animate) return Promise.resolve();
        var run = card.animate([{ transform: from === 'none' ? transform(0) : from }, { transform: target }], {
          duration: duration, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards'
        });
        animation = run;
        return run.finished.then(function () {
          if (animation === run) { animation = null; run.cancel(); }
        }, function () { /* cancelled by a new gesture, failure or navigation */ });
      }
      function restore() {
        start = null; axis = null;
        return animateTo(0, 160).then(function () {
          if (!animation && !start) { card.classList.remove('zx-moving'); stamp.style.opacity = '0'; }
        });
      }
      function begin(x, y) {
        if (hooks.blocked()) return;
        var offset = 0;
        if (animation) {
          var position = root.getComputedStyle(card).transform;
          animation.cancel(); animation = null; card.style.transform = position;
          var values = position.slice(position.indexOf('(') + 1, -1).split(',');
          offset = parseFloat(values[position.indexOf('matrix3d') === 0 ? 12 : 4]) || 0;
        }
        start = { x: x, y: y, offset: offset }; axis = null; dx = offset;
        samples = [{ x: offset, at: root.performance.now() }];
        card.classList.add('zx-moving');
      }
      function move(x, y, e) {
        if (!start || hooks.blocked()) return;
        var xChange = x - start.x, yChange = y - start.y;
        if (!axis && Math.abs(xChange) > 5) { axis = 'x'; card.classList.add('zx-dragging'); }
        if (axis !== 'x') return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        dx = start.offset + xChange;
        samples.push({ x: dx, at: root.performance.now() });
        while (samples.length > 2 && samples[1].at < root.performance.now() - 80) samples.shift();
        // Touch/pointer events can arrive more often than display frames.
        // Paint only the newest translation once per frame, with no layout reads.
        if (frame == null) frame = root.requestAnimationFrame(paint);
      }
      function end(x, y) {
        if (!start) return;
        var xChange = x - start.x, yChange = y - start.y;
        var translated = start.offset + xChange;
        var elapsed = root.performance.now() - samples[0].at;
        var speed = elapsed > 0 ? (translated - samples[0].x) / elapsed : 0;
        var flick = Math.abs(translated) >= 32 && Math.abs(speed) > .45 && speed * translated > 0;
        var commit = axis === 'x' && (Math.abs(translated) >= Math.min(72, card.clientWidth * .2) || flick) && Math.abs(xChange) > Math.abs(yChange) * .8;
        if (axis === 'x') { dx = translated; flush(); }
        start = null; axis = null;
        if (commit) hooks.commit(translated > 0 ? 'like' : 'skip');
        else restore();
      }
      function cancel() { pointer = null; if (start) restore(); }
      if (root.PointerEvent) {
        card.addEventListener('pointerdown', function (e) {
          if (!e.isPrimary) { cancel(); return; }
          if (e.button !== 0) return;
          e.stopPropagation(); pointer = e.pointerId; begin(e.clientX, e.clientY);
          if (start) card.setPointerCapture(pointer);
        });
        card.addEventListener('pointermove', function (e) { if (e.pointerId === pointer) move(e.clientX, e.clientY, e); });
        card.addEventListener('pointerup', function (e) { if (e.pointerId === pointer) { e.stopPropagation(); end(e.clientX, e.clientY); pointer = null; } });
        card.addEventListener('pointercancel', cancel);
        // Capture ending after a committed swipe must not recenter the card.
        card.addEventListener('lostpointercapture', cancel);
      } else {
        card.addEventListener('touchstart', function (e) { if (e.touches.length !== 1) { cancel(); return; } begin(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
        card.addEventListener('touchmove', function (e) { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); else cancel(); }, { passive: false });
        card.addEventListener('touchend', function (e) { if (!e.touches.length && e.changedTouches.length) end(e.changedTouches[0].clientX, e.changedTouches[0].clientY); });
        card.addEventListener('touchcancel', cancel);
      }
      return {
        dismiss: function (action) { return animateTo((action === 'like' ? 1 : -1) * Math.max(root.innerWidth, card.clientWidth) * 1.25, 190); },
        restore: restore,
        dispose: function () { start = null; if (frame != null) root.cancelAnimationFrame(frame); if (animation) animation.cancel(); }
      };
    }
    // ---- Catch Up ----
    function catchUp(body, gen) {
      var c = client(), owner = account(), userId = c.getCurrentUserId();
      var skips = skipStore(root.localStorage, owner), queue = [], index = 0, kind = 'Movie,Series', busy = false, request = 0, motion = null, preview = null;
      var tools = make('div', 'zx-tools'), kinds = make('div', 'zx-segment');
      kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Show');
      [['Movie,Series', 'Everything'], ['Movie', 'Movies'], ['Series', 'Shows']].forEach(function (v) { var b = button(v[1], 'zx-chip', function () { if (!busy) { kind = v[0]; load(); } }); b.dataset.value = v[0]; kinds.appendChild(b); });
      var reset = button('Show skipped again', 'zx-button zx-quiet', function () { if (!busy) { skips.clear(); load(); } });
      tools.append(kinds, reset);
      var stage = make('div', 'zx-catchup');
      var notice = make('p', 'zx-catchup-notice'); notice.setAttribute('role', 'status');
      var hint = make('p', 'zx-muted zx-hint', 'Swipe left to skip · Swipe right to like');
      body.append(tools, stage, hint, notice);

      function valid() { return live(gen) && account() === owner; }
      function setBusy(value) {
        busy = value;
        stage.setAttribute('aria-busy', String(value));
        body.querySelectorAll('button').forEach(function (b) { b.disabled = value; });
      }
      function load() {
        var token = ++request;
        queue = []; index = 0;
        kinds.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.value === kind)); });
        if (motion) motion.dispose(); motion = null; preview = null;
        notice.textContent = ''; loading(stage);
        var taste = root.ZorofinExtras.api('Zorofin/Companion/recommendations/taste').then(function (value) {
          if (!value || value.schemaVersion !== 1 || !Array.isArray(value.likedItemIds)) throw new Error('recommendations unavailable');
          return value.likedItemIds;
        });
        Promise.all([c.getItems(userId, {
          IncludeItemTypes: kind, Recursive: true, SortBy: 'Random', Limit: 60, HasOverview: true,
          Fields: 'Overview,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,BackdropImageTags,ImageTags,UserData,Genres',
          ImageTypeLimit: 1, EnableImageTypes: 'Backdrop,Logo,Primary', ExcludeLocationTypes: 'Virtual'
        }), taste]).then(function (result) {
          var r = result[0], liked = result[1];
          if (!valid() || token !== request) return;
          queue = ((r && r.Items) || []).filter(function (i) { return !skips.has(i.Id) && liked.indexOf(String(i.Id).replace(/-/g, '').toLowerCase()) < 0; });
          draw();
        }, function () { if (valid() && token === request) { stage.replaceChildren(); empty(stage, 'Couldn’t load picks', 'Check that recommendations are available, then try again.'); stage.appendChild(button('Try again', 'zx-button', load)); } });
      }
      function makeCard(item, behind) {
        var cardEl = make('article', behind ? 'zx-preview' : 'zx-card'); cardEl.dataset.itemId = item.Id;
        if (behind) cardEl.setAttribute('aria-hidden', 'true');
        else { cardEl.setAttribute('aria-label', item.Name); cardEl.tabIndex = 0; }
        var art = make('div', 'zx-card-art');
        var posterTag = item.ImageTags && item.ImageTags.Primary, backdropTag = item.BackdropImageTags && item.BackdropImageTags[0];
        if (posterTag || backdropTag) {
          var picture = make('picture'), img = make('img'); img.alt = ''; img.draggable = false;
          if (posterTag && backdropTag) { var source = make('source'); source.media = '(max-width: 700px)'; source.srcset = c.getImageUrl(item.Id, { type: 'Primary', tag: posterTag, maxWidth: 780, quality: 85 }); picture.appendChild(source); }
          img.src = c.getImageUrl(item.Id, { type: backdropTag ? 'Backdrop' : 'Primary', tag: backdropTag || posterTag, maxWidth: 1280, quality: 85 }); picture.appendChild(img); art.appendChild(picture);
        }
        var info = make('div', 'zx-card-info');
        info.appendChild(make('h2', behind ? 'zx-preview-title' : 'zx-card-title', item.Name));
        var meta = [item.ProductionYear, item.Type === 'Series' && item.ChildCount ? item.ChildCount + (item.ChildCount === 1 ? ' season' : ' seasons') : null, item.OfficialRating, item.CommunityRating ? '★ ' + Number(item.CommunityRating).toFixed(1) : null].filter(Boolean);
        info.appendChild(make('p', 'zx-muted', meta.join(' · ')));
        info.appendChild(make('p', 'zx-card-plot', item.Overview || ''));
        cardEl.append(art, info);
        return cardEl;
      }
      function draw(focusCard) {
        var item = queue[index], reuse = preview && item && preview.dataset.itemId === item.Id ? preview : null;
        if (motion) motion.dispose(); motion = null; preview = null;
        stage.replaceChildren();
        if (!item) { empty(stage, 'You’re all caught up', 'Try another filter, or show skipped titles again.'); if (focusCard) reset.focus({ preventScroll: true }); return; }
        var deck = make('div', 'zx-deck'), cardEl = reuse || makeCard(item, false);
        if (reuse) {
          cardEl.className = 'zx-card'; cardEl.removeAttribute('aria-hidden'); cardEl.setAttribute('aria-label', item.Name); cardEl.tabIndex = 0;
          cardEl.querySelector('.zx-preview-title').className = 'zx-card-title';
        }
        // Keep one real upcoming poster mounted and decoded; promote this exact
        // node after a decision instead of rebuilding a blank image on release.
        if (queue[index + 1]) { preview = makeCard(queue[index + 1], true); deck.appendChild(preview); }
        var stamp = make('span', 'zx-swipe-stamp'); stamp.setAttribute('aria-hidden', 'true');
        cardEl.appendChild(stamp); deck.appendChild(cardEl);
        var actions = make('div', 'zx-card-actions');
        actions.append(button('Skip', 'zx-button zx-skip', function () { act('skip'); }, 'close'), button('Like', 'zx-button zx-like', function () { act('like'); }, 'favorite'));
        stage.append(deck, actions, make('p', 'zx-muted zx-count', (index + 1) + ' of ' + queue.length));
        motion = bindSwipe(cardEl, stamp, { blocked: function () { return !valid() || busy; }, commit: act });
        if (focusCard) cardEl.focus({ preventScroll: true });
      }
      function act(action) {
        var item = queue[index], token = request;
        if (!item || busy || !valid() || (action !== 'like' && action !== 'skip')) return;
        setBusy(true); notice.textContent = action === 'like' ? 'Saving…' : '';
        var currentMotion = motion, leaving = currentMotion.dismiss(action);
        var saved = Promise.resolve().then(function () {
          if (action === 'skip') skips.add(item.Id);
          else return root.ZorofinExtras.api('Zorofin/Companion/recommendations/taste', {
            method: 'POST', body: { itemId: item.Id, action: 'like' }
          }).then(function (value) {
            var id = String(item.Id).replace(/-/g, '').toLowerCase();
            if (!value || !Array.isArray(value.likedItemIds) || value.likedItemIds.indexOf(id) < 0) throw new Error('like was not saved');
          });
        });
        Promise.all([saved, leaving]).then(function () {
          if (!valid() || token !== request) return;
          notice.textContent = action === 'skip' ? 'Skipped' : 'Liked for recommendations';
          index++; setBusy(false); draw(true);
        }, function () {
          if (!valid() || token !== request) return;
          currentMotion.restore().then(function () {
            if (!valid() || token !== request) return;
            setBusy(false); notice.textContent = 'Couldn’t save your like. Try again.';
          });
        });
      }
      body.addEventListener('keydown', function (e) {
        if (!e.target.closest('.zx-card')) return;
        var map = { ArrowLeft: 'skip', ArrowRight: 'like' };
        if (map[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); act(map[e.key]); }
      });
      load();
    }

    // ---- Pick Together (Catch Up → Together) ----
    // A group swipes on their own phones; titles everyone liked are matches.
    // Served by the companion's pickTogether module through the plugin.
    var PICK = 'Zorofin/Companion/pickTogether/';
    var AVATAR_COLORS = ['#3a6df0', '#d9822b', '#9b6be0', '#2fa36b', '#d6457a', '#2a9bb5', '#b8892a', '#7a7f87'];
    function pickApi(path, options) { return root.ZorofinExtras.api(PICK + path, options); }
    var pickCheck = null;
    function pickAvailable() {
      if (!root.ZorofinExtras) return Promise.resolve(false);
      var owner = account();
      if (pickCheck && pickCheck.owner === owner && Date.now() < pickCheck.expires) return pickCheck.promise;
      var check = { owner: owner, expires: Date.now() + 60000, enabled: false };
      pickCheck = check;
      check.promise = root.ZorofinExtras.api('Zorofin/Capabilities').then(function (value) {
        var feature = value && value.features && value.features.pickTogether;
        check.enabled = Boolean(feature && feature.enabled !== false && (!feature.version || feature.version === 1));
        return check.enabled;
      }, function () { return false; });
      return check.promise;
    }
    // The group this browser tab is in, per account, so a reload or a trip to
    // a title page comes back to it.
    function tvLayout() { return doc.documentElement.classList.contains('layout-tv') || doc.body.classList.contains('layout-tv'); }
    function pickMemory(owner, display) {
      var key = (display ? 'zorofin-pick-display:' : 'zorofin-pick:') + owner, store = root.sessionStorage;
      return {
        get: function () { try { var v = JSON.parse(store.getItem(key) || 'null'); return v && /^[0-9a-f]{32}$/.test(v.id) ? v : null; } catch (_) { return null; } },
        set: function (v) { try { store.setItem(key, JSON.stringify(v)); } catch (_) { /* private mode */ } },
        clear: function () { try { store.removeItem(key); } catch (_) { /* private mode */ } }
      };
    }
    function avatar(name, index, cls) {
      var a = make('span', cls || 'zp-avatar', String(name || '?').charAt(0).toUpperCase());
      a.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
      a.setAttribute('aria-hidden', 'true');
      return a;
    }
    function qrSvg(text) {
      var m = qrMatrix(text);
      if (!m) return null;
      var n = m.length, quiet = 2, d = '', ns = 'http://www.w3.org/2000/svg';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z';
      var svg = doc.createElementNS(ns, 'svg'), bg = doc.createElementNS(ns, 'rect'), path = doc.createElementNS(ns, 'path');
      svg.setAttribute('viewBox', '0 0 ' + (n + quiet * 2) + ' ' + (n + quiet * 2));
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for the invite link');
      svg.setAttribute('shape-rendering', 'crispEdges');
      bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
      path.setAttribute('d', d); path.setAttribute('fill', '#0d110f');
      svg.append(bg, path);
      return svg;
    }
    function joinLink(code) { return root.location.href.split('#')[0] + '#/home?zorofin=catchup&pick=' + code; }
    function runtimeText(minutes) {
      if (!minutes) return '';
      var h = Math.floor(minutes / 60), m = minutes % 60;
      return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
    }
    function cardMeta(card) {
      var length = card.type === 'Series' ? (card.seasons ? card.seasons + (card.seasons === 1 ? ' season' : ' seasons') : '') : runtimeText(card.runtimeMinutes);
      return [card.year, card.genres && card.genres[0], length].filter(Boolean).join(' · ');
    }
    function posterBox(card, cls, width) {
      var box = make('div', cls);
      if (card.imageTag) {
        var img = make('img'); img.alt = ''; img.draggable = false; img.decoding = 'async';
        img.src = client().getImageUrl(card.itemId, { type: 'Primary', tag: card.imageTag, maxWidth: width || 600, quality: 85 });
        box.appendChild(img);
      } else box.appendChild(make('span', 'zp-poster-title', card.title));
      return box;
    }

    function together(body, gen, joinCode) {
      var c = client(), owner = account(), display = tvLayout(), memory = pickMemory(owner, display);
      var kind = 'movie', session = null, seat = null, deck = [], index = 0, view = '', busy = false;
      var poll = null, motion = null, known = null;
      var stage = make('div', 'zp-stage'), notice = make('p', 'zp-notice'); notice.setAttribute('role', 'status');
      body.append(stage, notice);

      function valid() { return live(gen) && account() === owner; }
      // Marks the page with the current screen so phone CSS can give the deck
      // the whole screen and keep Skip/Like within thumb reach.
      function screen(name) { view = name; var page = body.closest('#zoroExtrasPage'); if (page && live(gen)) page.dataset.zpView = name; }
      function buzz(pattern) { try { if (root.navigator.vibrate) root.navigator.vibrate(pattern); } catch (e) { /* no haptics */ } }
      function say(text) { notice.textContent = text || ''; }
      function stopAll() { if (poll) root.clearInterval(poll); poll = null; if (motion) motion.dispose(); motion = null; }
      function seatQuery(extra) { return '?seat=' + encodeURIComponent(seat || '') + (extra || ''); }
      function me() { return session ? session.members.filter(function (m) { return m.seat === seat; })[0] : null; }
      function others() { return session ? session.members.filter(function (m) { return !m.display && m.seat !== seat; }) : []; }
      function adopt(state) {
        session = state;
        if (state.seat) seat = state.seat;
        memory.set({ id: state.id, seat: seat });
        if (!known) { known = {}; state.matches.forEach(function (m) { known[m.itemId] = true; }); }
        if (!poll) poll = root.setInterval(tick, 2000);
      }
      function gone(text) {
        stopAll(); memory.clear(); session = null; seat = null; known = null;
        drawStart(); say(text === undefined ? 'That group has ended.' : text);
      }
      function tick() {
        if (!valid()) { stopAll(); return; }
        if (!session || busy || doc.hidden) return;
        pickApi('sessions/' + session.id + seatQuery('&since=' + session.version)).then(function (state) {
          if (!valid() || !session) return;
          if (!state) { gone(); return; }
          if (state.unchanged) return;
          var before = session.status;
          var active = doc.activeElement;
          var controls = Array.from(stage.querySelectorAll('button'));
          var position = display ? controls.indexOf(active) : -1;
          adopt(state);
          updated(before);
          if (position >= 0 && !stage.contains(active)) {
            var buttons = Array.from(stage.querySelectorAll('button'));
            var target = buttons.filter(function (b) { return !b.disabled && b.dataset.pickKey && b.dataset.pickKey === active.dataset.pickKey; })[0]
              || buttons.filter(function (b) { return !b.disabled && b.textContent === active.textContent; })[0]
              || buttons.filter(function (b) { return !b.disabled; })[0];
            if (target) target.focus();
          }
        }, function () { /* keep the last state; the next tick retries */ });
      }
      function updated(before) {
        var fresh = session.matches.filter(function (m) { return !known[m.itemId]; });
        fresh.forEach(function (m) { known[m.itemId] = true; });
        if (session.status !== before) { route(); return; }
        if (view === 'lobby') drawLobby();
        else if (view === 'results') drawResults();
        else if (view === 'swipe') { chrome(); if (fresh.length && !busy) showMatch(fresh[0]); }
        else if (view === 'done') drawSwipe();
      }
      function route() {
        if (!session) { drawStart(); return; }
        if (session.status === 'lobby') drawLobby();
        else if (session.status === 'preparing') drawWaiting('Finding picks for everyone…');
        else if (session.status === 'swiping') { if (display) drawResults(); else if (view !== 'results' && view !== 'match') loadDeck(); else if (view === 'results') drawResults(); }
        else if (session.status === 'empty') drawProblem('Nothing to pick from', 'No titles are available to everyone in this group.');
        else if (session.status === 'failed') drawProblem('Couldn’t find picks', 'The server couldn’t read the library just now.');
        else if (session.status === 'ended') drawResults();
      }
      function act(promise, failure) {
        busy = true; say('');
        return promise.then(function (value) { busy = false; return value; }, function (error) { busy = false; if (valid()) say(failure); throw error; });
      }

      // Start: fanned posters, Movies or Shows, Start a group / Join with a code.
      function drawStart() {
        screen('start'); stage.replaceChildren();
        var wrap = make('div', 'zp-start'), fan = make('div', 'zp-fan');
        fan.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 3; i++) fan.appendChild(make('div', 'zp-fan-card'));
        c.getItems(c.getCurrentUserId(), { IncludeItemTypes: kind === 'movie' ? 'Movie' : 'Series', Recursive: true, SortBy: 'Random', Limit: 3, ImageTypeLimit: 1, EnableImageTypes: 'Primary', ExcludeLocationTypes: 'Virtual' }).then(function (r) {
          ((r && r.Items) || []).forEach(function (item, n) {
            var slot = fan.children[n];
            if (!slot || !item.ImageTags || !item.ImageTags.Primary) return;
            var img = make('img'); img.alt = ''; img.src = c.getImageUrl(item.Id, { type: 'Primary', tag: item.ImageTags.Primary, maxWidth: 400, quality: 80 });
            slot.appendChild(img);
          });
        }, function () { /* plain cards are fine */ });
        var kinds = make('div', 'zx-segment zp-kinds'); kinds.setAttribute('role', 'group'); kinds.setAttribute('aria-label', 'Pick from');
        [['movie', 'Movies'], ['series', 'Shows']].forEach(function (k) {
          var b = button(k[1], 'zx-chip', function () { kind = k[0]; drawStart(); });
          b.setAttribute('aria-pressed', String(kind === k[0])); kinds.appendChild(b);
        });
        var start = button('Start a group', 'zx-button zx-primary zp-wide', function () {
          act(pickApi('sessions', { method: 'POST', body: display ? { kind: kind, display: true } : { kind: kind } }), 'Couldn’t start a group. Try again.').then(function (state) {
            if (!valid() || !state) return;
            adopt(state); route();
          }, function () {});
        });
        var form = make('form', 'zp-join'); form.hidden = true; form.noValidate = true;
        var label = make('label', 'zp-label', 'Group code'), input = make('input', 'zp-input');
        input.id = 'zpJoinCode'; label.htmlFor = input.id; input.autocomplete = 'off'; input.spellcheck = false;
        input.setAttribute('autocapitalize', 'characters'); input.setAttribute('enterkeyhint', 'go'); input.maxLength = 9; input.placeholder = 'ABC 123';
        var joinBtn = make('button', 'zx-button', 'Join'); joinBtn.type = 'submit';
        var row = make('div', 'zp-join-row'); row.append(input, joinBtn);
        form.append(label, row);
        form.addEventListener('submit', function (e) { e.preventDefault(); join(input.value); });
        var toggle = button('Join with a code', 'zx-button zx-quiet zp-wide', function () {
          form.hidden = false; toggle.hidden = true; wrap.classList.add('zp-joining');
          input.focus({ preventScroll: true });
          root.setTimeout(function () { if (form.isConnected) form.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 250);
        });
        var actions = make('div', 'zp-actions'); actions.append(kinds, start); if (!display) actions.append(toggle, form);
        wrap.append(fan, make('h2', 'zp-headline', 'Swipe together, watch what everyone likes'),
          make('p', 'zx-muted zp-sub', 'Everyone swipes on their own phone. Picks are based on what each of you has watched and liked.'), actions);
        stage.appendChild(wrap);
      }
      function join(code) {
        var clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (clean.length < 6) { say('Enter the 6-character code from the group.'); return; }
        act(pickApi('join', { method: 'POST', body: { code: clean } }), 'Couldn’t join. The group may be full.').then(function (state) {
          if (!valid()) return;
          if (!state) { say('No group with that code. Check it and try again.'); return; }
          adopt(state); route();
        }, function () {});
      }

      // Lobby: QR and code, share link, who joined, Start swiping for the host.
      function drawLobby() {
        screen('lobby'); stage.replaceChildren();
        var link = joinLink(session.code), voters = session.members.filter(function (m) { return !m.display; });
        var head = make('div', 'zp-center');
        head.append(make('h2', 'zp-title', session.kind === 'movie' ? 'Movie night' : 'Show night'),
          make('p', 'zx-muted', (session.kind === 'movie' ? 'Movies' : 'Shows') + ' · ' + voters.length + ' joined'));
        var qr = make('div', 'zp-qr-card'), code = session.code.slice(0, 3) + ' ' + session.code.slice(3), svg = qrSvg(link);
        if (svg) { var box = make('div', 'zp-qr'); box.appendChild(svg); qr.appendChild(box); }
        var codeEl = make('p', 'zp-code', code); codeEl.setAttribute('aria-label', 'Group code ' + session.code.split('').join(' '));
        qr.append(codeEl, make('p', 'zx-muted zp-small', 'Scan with a phone camera, or enter the code in Catch Up'));
        var share = button('Share invite link', 'zx-button zp-row', function () { invite(link); }, 'ios_share');
        var people = make('ul', 'zp-people'); people.setAttribute('aria-label', 'In the group');
        session.members.forEach(function (m, n) {
          var li = make('li', 'zp-person');
          li.append(avatar(m.name, n, 'zp-avatar zp-avatar-lg'), make('span', '', m.you && !m.display ? 'You' : m.name + (m.display ? ' (TV)' : '')));
          people.appendChild(li);
        });
        var add = make('li', 'zp-person'), addBtn = button('', 'zp-avatar zp-avatar-lg zp-invite', function () { invite(link); }, 'add');
        addBtn.setAttribute('aria-label', 'Invite someone'); add.append(addBtn, make('span', 'zx-muted', 'Invite')); people.appendChild(add);
        var foot = make('div', 'zp-foot');
        foot.appendChild(make('p', 'zx-muted zp-small', 'About 20 picks each. Same titles for everyone, in your own order.'));
        if (session.host) {
          var go = button(voters.length < 2 ? 'Waiting for someone to join' : 'Start swiping', 'zx-button zx-primary zp-wide', function () {
            act(pickApi('sessions/' + session.id + '/start' + seatQuery(), { method: 'POST', body: { seat: seat } }), 'Couldn’t start. Try again.').then(function (state) {
              if (valid() && state) { adopt(state); route(); }
            }, function () {});
          });
          go.disabled = voters.length < 2; foot.appendChild(go);
        } else foot.appendChild(make('p', 'zp-wait', 'Waiting for the host to start'));
        foot.appendChild(button(display && session.host ? 'Cancel group' : 'Leave group', 'zx-button zx-quiet zp-wide', display && session.host ? end : leave));
        stage.append(head, qr); if (!display) stage.appendChild(share); else add.remove(); stage.append(people, foot);
      }
      function invite(link) {
        var text = 'Join my group to pick something to watch. Code ' + session.code + '.';
        if (root.navigator.share) { root.navigator.share({ title: 'Pick something together', text: text, url: link }).catch(function () {}); return; }
        if (root.navigator.clipboard) root.navigator.clipboard.writeText(link).then(function () { say('Invite link copied'); }, function () { say(link); });
        else say(link);
      }
      function leave() {
        if (!session) { drawStart(); return; }
        var id = session.id;
        act(pickApi('sessions/' + id + '/leave' + seatQuery(), { method: 'POST', body: { seat: seat } }), '').then(function () { gone('You left the group.'); }, function () { gone('You left the group.'); });
      }
      function drawWaiting(text) { screen('waiting'); stage.replaceChildren(make('p', 'zx-muted zx-loading', text)); }
      function drawProblem(title, text) {
        screen('problem'); stage.replaceChildren(); empty(stage, title, text);
        if (session && session.host) stage.appendChild(button('End group', 'zx-button', end));
        stage.appendChild(button('Leave group', 'zx-button zx-quiet', leave));
      }

      // Swiping: thin progress bar, match pill, the card, Skip and Like.
      function loadDeck() {
        drawWaiting('Getting your picks…');
        pickApi('sessions/' + session.id + '/deck' + seatQuery()).then(function (value) {
          if (!valid() || !value) return;
          deck = value.cards || []; index = 0; drawSwipe();
        }, function () { if (valid()) drawProblem('Couldn’t load your picks', 'Check your connection, then try again.'); });
      }
      function chrome() {
        var bar = stage.querySelector('.zp-progress'), pill = stage.querySelector('.zp-pill-text');
        var mine = me(), total = mine ? mine.total : deck.length, done = mine ? mine.swiped : index;
        if (bar) Array.prototype.forEach.call(bar.children, function (seg, n) { seg.classList.toggle('zp-on', n < done); });
        if (bar) bar.setAttribute('aria-valuenow', String(done));
        if (pill) pill.textContent = session.matches.length + (session.matches.length === 1 ? ' match' : ' matches');
        void total;
      }
      function drawSwipe() {
        if (motion) motion.dispose(); motion = null;
        var card = deck[index];
        stage.replaceChildren();
        var mine = me(), total = Math.max(mine ? mine.total : deck.length, 1);
        var bar = make('div', 'zp-progress'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Your picks');
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(total));
        for (var i = 0; i < Math.min(total, 30); i++) bar.appendChild(make('span', 'zp-seg'));
        var top = make('div', 'zp-swipe-top');
        var quit = button('', 'zx-icon-button zp-plain', leave, 'close'); quit.setAttribute('aria-label', 'Leave group');
        var pill = button('', 'zp-pill', drawResults), faces = make('span', 'zp-faces');
        others().slice(0, 3).forEach(function (m, n) { faces.appendChild(avatar(m.name, n + 1, 'zp-avatar zp-avatar-xs')); });
        var heart = icon('favorite'); heart.className += ' zp-heart';
        pill.append(faces, heart, make('span', 'zp-pill-text', ''));
        pill.setAttribute('aria-label', 'See matches');
        top.append(quit, pill);
        if (!card) {
          screen('done');
          var waiting = others().filter(function (m) { return !m.done; }).length;
          stage.append(bar, top);
          empty(stage, 'You’re done', waiting ? 'Waiting for ' + waiting + (waiting === 1 ? ' person' : ' people') + ' to finish.' : 'Everyone’s done.');
          stage.appendChild(button('See matches', 'zx-button zx-primary', drawResults));
          chrome();
          return;
        }
        screen('swipe');
        var deckEl = make('div', 'zx-deck zp-deck');
        if (deck[index + 1]) { var behind = make('article', 'zx-preview zp-card'); behind.setAttribute('aria-hidden', 'true'); behind.appendChild(posterBox(deck[index + 1], 'zx-card-art', 780)); deckEl.appendChild(behind); }
        var el = make('article', 'zx-card zp-card'); el.dataset.itemId = card.itemId; el.tabIndex = 0; el.setAttribute('aria-label', card.title);
        var info = make('div', 'zx-card-info');
        info.append(make('h2', 'zx-card-title', card.title), make('p', 'zx-muted', cardMeta(card)));
        if (card.reason) info.appendChild(make('p', 'zp-reason', card.reason));
        var stamp = make('span', 'zx-swipe-stamp'); stamp.setAttribute('aria-hidden', 'true');
        el.append(posterBox(card, 'zx-card-art', 780), info, stamp);
        deckEl.appendChild(el);
        var actions = make('div', 'zx-card-actions');
        actions.append(button('Skip', 'zx-button zx-skip', function () { swipe('skip'); }, 'close'), button('Like', 'zx-button zx-like', function () { swipe('like'); }, 'favorite'));
        stage.append(bar, top, deckEl, actions);
        motion = bindSwipe(el, stamp, { blocked: function () { return !valid() || busy; }, commit: swipe });
        el.addEventListener('keydown', function (e) {
          var map = { ArrowLeft: 'skip', ArrowRight: 'like' };
          if (map[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); swipe(map[e.key]); }
        });
        chrome();
        el.focus({ preventScroll: true });
      }
      function swipe(choice) {
        var card = deck[index], current = motion;
        if (!card || busy || !valid() || !current) return;
        busy = true; say(''); buzz(8);
        var leaving = current.dismiss(choice);
        var saved = pickApi('sessions/' + session.id + '/swipes' + seatQuery(), { method: 'POST', body: { itemId: card.itemId, choice: choice, seat: seat } });
        Promise.all([saved, leaving]).then(function (result) {
          busy = false;
          if (!valid()) return;
          var reply = result[0] || {};
          index++;
          var mine = me(); if (mine) mine.swiped++;
          if (reply.match) { known[reply.match.itemId] = true; session.matches = session.matches.filter(function (m) { return m.itemId !== reply.match.itemId; }).concat([reply.match]); showMatch(reply.match); }
          else drawSwipe();
        }, function () {
          busy = false;
          if (!valid()) return;
          current.restore();
          say('Couldn’t save that swipe. Try again.');
        });
      }

      // It's a match: the poster, everyone's faces, one useful line.
      function showMatch(match) {
        if (motion) motion.dispose(); motion = null;
        screen('match'); stage.replaceChildren(); buzz([12, 60, 18]);
        var box = make('div', 'zp-match'), art = make('div', 'zp-match-art'), faces = make('div', 'zp-match-faces');
        session.members.filter(function (m) { return !m.display; }).slice(0, 5).forEach(function (m, n) { faces.appendChild(avatar(m.name, n, 'zp-avatar zp-avatar-md')); });
        var heart = make('span', 'zp-avatar zp-avatar-md zp-match-heart'); heart.appendChild(icon('favorite')); faces.appendChild(heart);
        art.append(posterBox(match, 'zp-match-poster', 600), faces);
        var line = (match.of === 2 ? 'Both of you' : 'All ' + match.of + ' of you') + ' liked ' + match.title + '.';
        if (match.type !== 'Series' && match.runtimeMinutes) {
          var end = new Date(Date.now() + match.runtimeMinutes * 60000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          line += ' ' + runtimeText(match.runtimeMinutes) + ', so you’re done by ' + end + '.';
        }
        var see = button('See matches', 'zx-button zx-primary zp-wide', drawResults);
        box.append(art, make('h2', 'zp-match-title', 'It’s a match'), make('p', 'zx-muted zp-match-line', line), see,
          button('Keep swiping', 'zx-button zx-quiet zp-wide', drawSwipe));
        stage.appendChild(box);
        see.focus({ preventScroll: true });
      }

      // Results: everyone liked, then almost; counts only.
      function drawResults() {
        if (motion) motion.dispose(); motion = null;
        screen('results'); stage.replaceChildren();
        var head = make('div', 'zp-results-head');
        head.append(make('h2', 'zp-title', 'Your matches'), make('p', 'zx-muted', (session.kind === 'movie' ? 'Movies' : 'Shows') + (session.status === 'ended' ? ' · ended' : '')));
        stage.appendChild(head);
        if (display && session.status === 'swiping') {
          var progress = make('ul', 'zp-people'); progress.setAttribute('aria-label', 'Voting progress');
          session.members.filter(function (m) { return !m.display; }).forEach(function (m) {
            progress.appendChild(make('li', 'zp-person', m.name + ' · ' + m.swiped + ' of ' + m.total));
          });
          stage.appendChild(progress);
        }
        if (session.matches.length) {
          stage.appendChild(make('h3', 'zp-section', 'Everyone liked'));
          var list = make('ul', 'zp-list');
          session.matches.forEach(function (m) { list.appendChild(resultRow(m, true)); });
          stage.appendChild(list);
        } else stage.appendChild(make('p', 'zx-muted zp-none', session.status === 'ended' ? 'No matches this time.' : 'No matches yet. Keep swiping, or try another round.'));
        if (session.almost.length) {
          var h = make('h3', 'zp-section', 'Almost'); h.appendChild(make('span', 'zx-muted', ' · all but one'));
          var more = make('ul', 'zp-list zp-list-compact');
          session.almost.forEach(function (m) { more.appendChild(resultRow(m, false)); });
          stage.append(h, more);
        }
        stage.appendChild(make('p', 'zx-muted zp-small zp-center', 'Only counts are shown, never who skipped.'));
        var actions = make('div', 'zp-result-actions');
        if (session.status === 'ended') actions.appendChild(button('Start a new group', 'zx-button zx-primary', function () { gone(''); }));
        else {
          if (deck.length > index) actions.appendChild(button('Back to swiping', 'zx-button zx-primary', drawSwipe));
          if (session.host) {
            actions.appendChild(button('Another round', 'zx-button', function () {
              act(pickApi('sessions/' + session.id + '/next-round' + seatQuery(), { method: 'POST', body: { seat: seat } }), 'Couldn’t start another round.').then(function (state) {
                if (valid() && state) { adopt(state); screen(''); route(); }
              }, function () {});
            }));
            actions.appendChild(button('End session', 'zx-button', end));
          } else actions.appendChild(button('Leave group', 'zx-button', leave));
        }
        stage.appendChild(actions);
      }
      function resultRow(m, full) {
        var li = make('li', 'zp-result');
        li.append(posterBox(m, 'zp-thumb', 200));
        var text = make('div', 'zp-result-text');
        text.append(make('span', 'zp-result-title', m.title), make('span', 'zx-muted zp-small', cardMeta(m)), make('span', 'zp-likes', m.likes + ' of ' + m.of + ' liked'));
        var buttons = make('div', 'zp-result-buttons');
        buttons.appendChild(button(full ? 'Open' : 'Open', full ? 'zx-button zx-primary zp-sm' : 'zx-button zp-sm', function () { details(m.itemId); }));
        if (full) buttons.appendChild(button('Watch together', 'zx-button zp-sm', function () { close(); root.location.hash = '#/mypreferencesmenu?watchTogether=1'; }));
        Array.prototype.forEach.call(buttons.children, function (b, n) { b.dataset.pickKey = m.itemId + '-' + n; });
        text.appendChild(buttons);
        li.appendChild(text);
        return li;
      }
      function end() {
        act(pickApi('sessions/' + session.id + '/end' + seatQuery(), { method: 'POST', body: { seat: seat } }), 'Couldn’t end the group.').then(function (state) {
          if (valid() && state) { adopt(state); drawResults(); }
        }, function () {});
      }

      // Open: a join link, the group this tab was already in, or the start screen.
      var remembered = memory.get();
      if (joinCode && !display) {
        root.history.replaceState(root.history.state, '', '#/home?zorofin=catchup&together=1');
        drawStart(); join(joinCode);
      } else if (remembered) {
        seat = remembered.seat;
        drawWaiting('Loading your group…');
        pickApi('sessions/' + remembered.id + seatQuery()).then(function (state) {
          if (!valid()) return;
          if (!state || state.unchanged) { gone(''); return; }
          adopt(state); route();
        }, function () { if (valid()) gone(''); });
      } else drawStart();
    }

    // ---- Entry points ----
    var entryRun = 0;
    function addEntries() {
      var run = ++entryRun, owner = account();
      extras().then(function (ex) {
        if (run !== entryRun || owner !== account()) return;
        state.extras = ex;
        if (tvLayout() && pageOn(ex, 'catchup')) pickAvailable();
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
        var profile = /^#\/mypreferencesmenu(?:[?]|$)/.test(root.location.hash) && doc.querySelector('#myPreferencesMenuPage:not(.hide)');
        var content = profile && profile.querySelector('.readOnlyContent');
        if (!content) return;
        // Never insert links into the first verticalSection: that section owns
        // the account heading. Keep extras in their own full-width settings list.
        var group = content.querySelector('.zx-profile-links');
        if (!phone || !on.length) {
          if (group) group.remove();
          profile.querySelectorAll('.zx-profile-link').forEach(function (a) { a.remove(); });
          return;
        }
        if (!group) {
          group = make('nav', 'zx-profile-links');
        }
        group.setAttribute('aria-label', on.map(function (p) { return PAGES[p].label; }).join(' and '));
        var anchor = Array.from(content.children).find(function (node) { return node !== group && node.matches('.zoroProfileShortcuts,.btnLogout,#logout,[data-action="logout"]'); });
        if (group.parentElement !== content || group.nextElementSibling !== (anchor || null)) content.insertBefore(group, anchor || null);
        profile.querySelectorAll('.zx-profile-link').forEach(function (a) {
          if (a.parentElement !== group || on.indexOf(a.dataset.zoroPage) < 0) a.remove();
        });
        on.forEach(function (p, index) {
            var a = group.querySelector('[data-zoro-page="' + p + '"]');
            if (a) { if (group.children[index] !== a) group.insertBefore(a, group.children[index] || null); return; }
            a = make('a', 'listItem-border emby-button zx-profile-link focusable'); a.href = '#/home?zorofin=' + p; a.dataset.zoroPage = p;
            var row = make('div', 'listItem'); var i = make('span', 'material-icons listItemIcon listItemIcon-transparent', PAGES[p].icon); i.setAttribute('aria-hidden', 'true');
            var t = make('div', 'listItemBody'); t.appendChild(make('div', 'listItemBodyText', PAGES[p].label)); row.append(i, t); a.appendChild(row);
            a.addEventListener('click', function (e) { e.preventDefault(); open(p); });
            group.insertBefore(a, group.children[index] || null);
        });
      });
    }
    // Account menu (zorofin-account-menu.js) reads this list.
    root.ZorofinMenuExtras = function () {
      var ex = state.extras;
      var entries = Object.keys(PAGES).filter(function (p) { return pageOn(ex, p); }).map(function (p) { return { key: 'page-' + p, label: PAGES[p].label, run: function () { open(p); } }; });
      if (tvLayout() && pageOn(ex, 'catchup') && pickCheck && pickCheck.owner === account() && pickCheck.enabled) {
        entries.push({ key: 'pick-together', label: 'Pick Together', run: function () { root.location.hash = '#/home?zorofin=catchup&together=1'; } });
      }
      return entries;
    };

    var queued = false;
    function schedule() { if (queued) return; queued = true; root.requestAnimationFrame(function () { queued = false; addEntries(); }); }
    root.addEventListener('hashchange', function () { sync(); schedule(); });
    root.addEventListener('popstate', sync);
    doc.addEventListener('viewshow', schedule);
    doc.addEventListener('keydown', function (e) { if (state.el && (e.key === 'Escape' || e.keyCode === 461) && !doc.querySelector('.dialogContainer')) { e.preventDefault(); root.history.back(); } });
    root.addEventListener('resize', function () { if (state.el) state.el.style.setProperty('--zx-top', headerBottom()); schedule(); });
    new MutationObserver(function (records) {
      if (records.some(function (r) { return Array.from(r.addedNodes).some(function (node) {
        return node.nodeType === 1 && (node.matches('#myPreferencesMenuPage,.readOnlyContent,.mainDrawer-scrollContainer,.zoroProfileShortcuts') || node.querySelector('#myPreferencesMenuPage,.mainDrawer-scrollContainer'));
      }); })) schedule();
    }).observe(doc.body, { childList: true, subtree: true });
    root.setTimeout(function () { sync(); schedule(); }, 800);
  }

  return { mount: mount, qrMatrix: qrMatrix, groupByDay: groupByDay, monthGrid: monthGrid, eventDay: eventDay, dayKey: dayKey, skipStore: skipStore, dayLabel: dayLabel };
}));
