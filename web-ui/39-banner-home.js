/* Zorofin Home banner: a few featured movies and shows from the viewer's own
 * libraries, rotating at the top of Home like the Zorofin apps. It draws the
 * same #slides-container markup the theme already styles, so servers don't
 * need the Media Bar plugin. When Media Bar is installed it stands down and
 * Media Bar keeps the banner. Play goes through Jellyfin's own player
 * (zorofin-home-layout.js handles the Play button). */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var ROTATE_MS = 8000, COUNT = 8, REFRESH_MS = 30 * 60 * 1000;

  function minutes(ticks) {
    var total = Math.round((Number(ticks) || 0) / 600000000);
    if (!total) return '';
    var h = Math.floor(total / 60), m = total % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }
  // The small line under the title: year, length or seasons, rating and score.
  function details(item) {
    var parts = [];
    if (item.ProductionYear) parts.push(String(item.ProductionYear));
    if (item.Type === 'Series') { if (item.ChildCount) parts.push(item.ChildCount + (item.ChildCount === 1 ? ' season' : ' seasons')); }
    else if (minutes(item.RunTimeTicks)) parts.push(minutes(item.RunTimeTicks));
    if (item.OfficialRating) parts.push(item.OfficialRating);
    if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
    return parts.join(' · ');
  }
  function pick(items) {
    return (items || []).filter(function (item) {
      return item && item.Id && item.BackdropImageTags && item.BackdropImageTags.length && (item.Type === 'Movie' || item.Type === 'Series');
    }).slice(0, COUNT);
  }

  function mount() {
    var doc = root.document, html = doc.documentElement;
    if (root.ZorofinHomeBanner) return;
    var state = { key: '', items: null, loadedAt: 0, index: 0, timer: 0, paused: false, el: null, loading: false };
    root.ZorofinHomeBanner = { version: '1.0.0' };

    function client() { return root.ApiClient; }
    function who() {
      try { var c = client(); return c && c.getCurrentUserId() && c.accessToken() ? c.serverId() + ':' + c.getCurrentUserId() : ''; } catch (_) { return ''; }
    }
    function onHome() { return /^#\/home(?:[?]|$)/.test(root.location.hash) && !/[?&]zorofin=requests(?:&|$)/.test(root.location.hash); }
    // Media Bar, when installed, owns #slides-container.
    function mediaBar() {
      var other = doc.getElementById('slides-container');
      return Boolean(root.mediaBarEnhanced || (other && !other.hasAttribute('data-zoro-banner')) || doc.querySelector('script[src*="mediaBarEnhanced"]'));
    }
    function make(tag, cls, text) { var el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
    function icon(name) { var i = make('span', 'material-icons', name); i.setAttribute('aria-hidden', 'true'); return i; }

    function load() {
      var c = client(), key = who();
      if (!c || !key || state.loading) return;
      state.loading = true;
      c.getItems(c.getCurrentUserId(), {
        IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 24,
        ImageTypeLimit: 1, EnableImageTypes: 'Backdrop,Logo', HasOverview: true,
        Fields: 'Overview,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,BackdropImageTags,ImageTags,UserData',
        IsPlayed: false, ExcludeLocationTypes: 'Virtual'
      }).then(function (result) {
        if (who() !== key) return;
        state.key = key; state.items = pick(result && result.Items); state.loadedAt = Date.now(); state.index = 0;
        render();
      }, function () { state.items = []; render(); }).then(function () { state.loading = false; }, function () { state.loading = false; });
    }

    function slide(item, active) {
      var c = client(), s = make('div', 'slide' + (active ? ' active' : ''));
      s.dataset.itemId = item.Id;
      var back = make('div', 'backdrop-container'), img = make('img', 'backdrop');
      img.alt = ''; img.decoding = 'async'; img.loading = active ? 'eager' : 'lazy';
      img.src = c.getImageUrl(item.Id, { type: 'Backdrop', index: 0, tag: item.BackdropImageTags[0], maxWidth: 1920, quality: 85 });
      back.appendChild(img);
      var logo = make('div', 'logo-container');
      if (item.ImageTags && item.ImageTags.Logo) {
        var mark = make('img', 'logo'); mark.alt = item.Name;
        mark.src = c.getImageUrl(item.Id, { type: 'Logo', tag: item.ImageTags.Logo, maxWidth: 800, quality: 90 });
        logo.appendChild(mark);
      } else logo.appendChild(make('h2', 'zoroBannerTitle', item.Name));
      var info = make('div', 'info-container'); info.appendChild(make('div', 'misc-info', details(item)));
      var plot = make('div', 'plot-container'); plot.appendChild(make('div', 'plot', item.Overview || ''));
      var buttons = make('div', 'button-container');
      var play = make('button', 'play-button'); play.type = 'button'; play.append(icon('play_arrow'), make('span', '', 'Play'));
      var more = make('button', 'detail-button'); more.type = 'button'; more.setAttribute('aria-label', 'More info'); more.appendChild(icon('info_outline'));
      more.addEventListener('click', function () { root.location.hash = '#/details?id=' + encodeURIComponent(item.Id) + '&serverId=' + encodeURIComponent(c.serverId()); });
      var fav = make('button', 'favorite-button'); fav.type = 'button'; fav.setAttribute('aria-label', 'My List');
      function heart() { var on = Boolean(item.UserData && item.UserData.IsFavorite); fav.replaceChildren(icon(on ? 'favorite' : 'favorite_border')); fav.setAttribute('aria-pressed', String(on)); }
      heart();
      fav.addEventListener('click', function () {
        var next = !(item.UserData && item.UserData.IsFavorite);
        Promise.resolve(c.updateFavoriteStatus(c.getCurrentUserId(), item.Id, next)).then(function () { item.UserData = Object.assign({}, item.UserData, { IsFavorite: next }); heart(); });
      });
      buttons.append(play, more, fav);
      s.append(back, make('div', 'gradient-overlay'), logo, info, plot, buttons);
      return s;
    }

    function show(index) {
      if (!state.el || !state.items || !state.items.length) return;
      state.index = (index + state.items.length) % state.items.length;
      state.el.querySelectorAll('.slide').forEach(function (s, i) { s.classList.toggle('active', i === state.index); });
      state.el.querySelectorAll('.dot').forEach(function (d, i) { d.classList.toggle('active', i === state.index); d.setAttribute('aria-current', String(i === state.index)); });
      schedule();
    }
    function schedule() {
      root.clearTimeout(state.timer);
      if (!state.paused && state.items && state.items.length > 1 && !doc.hidden) state.timer = root.setTimeout(function () { show(state.index + 1); }, ROTATE_MS);
    }

    function render() {
      if (state.el) { state.el.remove(); state.el = null; }
      root.clearTimeout(state.timer);
      if (!onHome() || !state.items || !state.items.length || mediaBar()) { html.classList.remove('zoro-own-banner'); return; }
      var box = make('div', ''); box.id = 'slides-container'; box.dataset.zoroBanner = 'true';
      box.setAttribute('role', 'region'); box.setAttribute('aria-roledescription', 'carousel'); box.setAttribute('aria-label', 'Featured');
      state.items.forEach(function (item, i) { box.appendChild(slide(item, i === state.index)); });
      if (state.items.length > 1) {
        var dots = make('div', 'dots-container');
        state.items.forEach(function (item, i) {
          var d = make('button', 'dot' + (i === state.index ? ' active' : '')); d.type = 'button'; d.setAttribute('aria-label', item.Name);
          d.addEventListener('click', function () { show(i); });
          dots.appendChild(d);
        });
        var pause = make('button', 'pause-button'); pause.type = 'button'; pause.setAttribute('aria-label', 'Pause');
        pause.appendChild(icon('pause'));
        pause.addEventListener('click', function () {
          state.paused = !state.paused; pause.replaceChildren(icon(state.paused ? 'play_arrow' : 'pause'));
          pause.setAttribute('aria-label', state.paused ? 'Resume' : 'Pause'); schedule();
        });
        box.append(dots, pause);
      }
      // Swipe between slides on touch screens.
      var startX = null;
      box.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
      box.addEventListener('touchend', function (e) {
        if (startX == null) return;
        var dx = e.changedTouches[0].clientX - startX; startX = null;
        if (Math.abs(dx) > 40) show(state.index + (dx < 0 ? 1 : -1));
      });
      box.addEventListener('keydown', function (e) {
        if (e.target.closest('.button-container')) return;
        if (e.key === 'ArrowRight') { show(state.index + 1); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { show(state.index - 1); e.preventDefault(); }
      });
      doc.body.appendChild(box);
      state.el = box;
      html.classList.add('zoro-own-banner');
      schedule();
    }

    function refresh() {
      if (!onHome()) { if (state.el) render(); return; }
      if (mediaBar()) { if (state.el) render(); return; }
      var key = who();
      if (!key) return;
      if (key !== state.key || !state.items || Date.now() - state.loadedAt > REFRESH_MS) load();
      else if (!state.el) render();
    }
    // Wait a moment at start so an installed Media Bar can claim the banner first.
    root.setTimeout(refresh, 600);
    root.addEventListener('hashchange', function () { root.setTimeout(refresh, 0); });
    doc.addEventListener('viewshow', refresh);
    doc.addEventListener('visibilitychange', schedule);
  }

  return { mount: mount, details: details, pick: pick, minutes: minutes };
}));
