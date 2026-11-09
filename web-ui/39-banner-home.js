/* Zorofin Home banner: a few featured movies and shows from the viewer's own
 * libraries, rotating at the top of Home like the Zorofin apps. It draws the
 * same #slides-container markup the theme already styles, so servers don't
 * need the Media Bar plugin. When Media Bar is installed it stands down and
 * Media Bar keeps the banner. Play goes through Jellyfin's own player
 * (zorofin-home-layout.js handles the Play button).
 *
 * With the Zorofin plugin's extras (zorofin-extras.js), the operator can pick
 * the titles in order and turn on trailers: each slide's YouTube trailer plays
 * muted behind it after a moment (starting past its intro, found with
 * SponsorBlock by the server), and a Trailer button plays it with sound. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var ROTATE_MS = 8000, COUNT = 8, REFRESH_MS = 30 * 60 * 1000, TRAILER_DELAY_MS = 2500, TRAILER_SLIDE_MS = 30000;
  var FIELDS = 'Overview,ProductionYear,OfficialRating,CommunityRating,RunTimeTicks,ChildCount,BackdropImageTags,ImageTags,UserData,RemoteTrailers';

  // Hand-picked titles keep the operator's order; ids the viewer can't see just drop out.
  function ordered(items, ids) {
    var byId = {};
    (items || []).forEach(function (item) { if (item && item.Id) byId[String(item.Id).replace(/-/g, '').toLowerCase()] = item; });
    return ids.map(function (id) { return byId[String(id).toLowerCase()]; }).filter(Boolean);
  }
  // The embed address for a muted, looping backdrop trailer.
  function embedUrl(id, start, sound) {
    var q = 'autoplay=1&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=0' + (start ? '&start=' + start : '');
    if (!sound) q += '&mute=1&controls=0&disablekb=1&loop=1&playlist=' + id;
    return 'https://www.youtube-nocookie.com/embed/' + id + '?' + q;
  }

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
    var state = { key: '', items: null, loadedAt: 0, index: 0, timer: 0, paused: false, el: null, loading: false, extras: null, trailerTimer: 0, playing: false };
    root.ZorofinHomeBanner = { version: '1.1.0' };

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

    function extras() {
      return root.ZorofinExtras ? root.ZorofinExtras.get().then(null, function () { return null; }) : Promise.resolve(null);
    }
    function random(c) {
      return c.getItems(c.getCurrentUserId(), {
        IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 24,
        ImageTypeLimit: 1, EnableImageTypes: 'Backdrop,Logo', HasOverview: true,
        Fields: FIELDS, IsPlayed: false, ExcludeLocationTypes: 'Virtual'
      }).then(function (result) { return pick(result && result.Items); });
    }
    function chosen(c, ids) {
      return c.getItems(c.getCurrentUserId(), { Ids: ids.join(','), EnableImageTypes: 'Backdrop,Logo', ImageTypeLimit: 1, Fields: FIELDS })
        .then(function (result) { return pick(ordered(result && result.Items, ids)); });
    }
    function load() {
      var c = client(), key = who();
      if (!c || !key || state.loading) return;
      state.loading = true;
      extras().then(function (ex) {
        state.extras = ex;
        var ids = ex && ex.banner && ex.banner.itemIds || [];
        // Hand-picked first; if none of them can be shown, fall back to the random pick.
        return (ids.length ? chosen(c, ids).then(function (list) { return list.length ? list : random(c); }, function () { return random(c); }) : random(c));
      }).then(function (items) {
        if (who() !== key) return;
        state.key = key; state.items = items; state.loadedAt = Date.now(); state.index = 0;
        render();
      }, function () { state.items = []; render(); }).then(function () { state.loading = false; }, function () { state.loading = false; });
    }

    // ---- Trailers ----
    function trailersOn() {
      var ex = state.extras, conn = root.navigator && root.navigator.connection;
      if (!ex || !ex.banner || !ex.banner.trailers) return false;
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      return !(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
    }
    function stopTrailer() {
      root.clearTimeout(state.trailerTimer);
      state.playing = false;
      if (state.el) state.el.querySelectorAll('.zoroBannerVideo').forEach(function (v) { v.remove(); });
      if (state.el) state.el.querySelectorAll('.slide.zoro-trailer-on').forEach(function (s) { s.classList.remove('zoro-trailer-on'); });
    }
    function startTrailer() {
      stopTrailer();
      if (!state.el || !trailersOn() || doc.hidden) return;
      var item = state.items[state.index], id = root.ZorofinExtras && root.ZorofinExtras.youTubeId(item);
      if (!id) return;
      var slideEl = state.el.querySelectorAll('.slide')[state.index], index = state.index;
      state.trailerTimer = root.setTimeout(function () {
        var skip = state.extras.banner.skipIntros && root.ZorofinExtras
          ? root.ZorofinExtras.api('Zorofin/Extras/Trailer/' + id).then(function (r) { return (r && r.start) || 0; }, function () { return 0; })
          : Promise.resolve(0);
        skip.then(function (start) {
          if (!state.el || state.index !== index || !slideEl.isConnected || doc.hidden) return;
          var frame = make('iframe', 'zoroBannerVideo');
          frame.src = embedUrl(id, start, false);
          frame.title = ''; frame.tabIndex = -1;
          frame.setAttribute('aria-hidden', 'true');
          frame.setAttribute('allow', 'autoplay; encrypted-media');
          frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
          // Show it only once YouTube's own loading screen has passed.
          frame.addEventListener('load', function () { root.setTimeout(function () { if (frame.isConnected) slideEl.classList.add('zoro-trailer-on'); }, 1200); });
          slideEl.querySelector('.backdrop-container').appendChild(frame);
          state.playing = true;
          schedule();
        });
      }, TRAILER_DELAY_MS);
    }
    function openTrailer(item) {
      var id = root.ZorofinExtras && root.ZorofinExtras.youTubeId(item);
      if (!id) return;
      stopTrailer(); state.paused = true; schedule();
      var back = make('div', 'zoroTrailerDialog'), box = make('div', 'zoroTrailerBox'), close = make('button', 'zoroTrailerClose');
      back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Trailer: ' + item.Name);
      close.type = 'button'; close.setAttribute('aria-label', 'Close trailer'); close.appendChild(icon('close'));
      var frame = make('iframe', ''); frame.src = embedUrl(id, 0, true); frame.title = 'Trailer: ' + item.Name;
      frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture'); frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      box.append(frame, close); back.appendChild(box);
      var opener = doc.activeElement;
      function done() {
        back.remove(); doc.removeEventListener('keydown', onKey, true); root.removeEventListener('hashchange', done);
        state.paused = false; schedule(); startTrailer();
        if (opener && opener.focus) opener.focus();
      }
      function onKey(e) { if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); done(); } }
      close.addEventListener('click', done);
      back.addEventListener('click', function (e) { if (e.target === back) done(); });
      doc.addEventListener('keydown', onKey, true);
      root.addEventListener('hashchange', done);
      doc.body.appendChild(back);
      close.focus();
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
      buttons.append(play);
      if (state.extras && state.extras.banner && state.extras.banner.trailers && root.ZorofinExtras && root.ZorofinExtras.youTubeId(item)) {
        var trailer = make('button', 'detail-button trailer-button'); trailer.type = 'button'; trailer.setAttribute('aria-label', 'Trailer');
        trailer.appendChild(icon('movie'));
        trailer.addEventListener('click', function () { openTrailer(item); });
        buttons.append(trailer);
      }
      buttons.append(more, fav);
      s.append(back, make('div', 'gradient-overlay'), logo, info, plot, buttons);
      return s;
    }

    function show(index) {
      if (!state.el || !state.items || !state.items.length) return;
      state.index = (index + state.items.length) % state.items.length;
      state.el.querySelectorAll('.slide').forEach(function (s, i) { s.classList.toggle('active', i === state.index); });
      state.el.querySelectorAll('.dot').forEach(function (d, i) { d.classList.toggle('active', i === state.index); d.setAttribute('aria-current', String(i === state.index)); });
      schedule();
      startTrailer();
    }
    function schedule() {
      root.clearTimeout(state.timer);
      // A playing trailer gets longer before the next slide.
      if (!state.paused && state.items && state.items.length > 1 && !doc.hidden) state.timer = root.setTimeout(function () { show(state.index + 1); }, state.playing ? TRAILER_SLIDE_MS : ROTATE_MS);
    }

    function render() {
      stopTrailer();
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
          if (state.paused) stopTrailer(); else startTrailer();
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
      startTrailer();
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
    doc.addEventListener('visibilitychange', function () { schedule(); if (doc.hidden) stopTrailer(); else if (state.el && !state.paused) startTrailer(); });
  }

  return { mount: mount, details: details, pick: pick, minutes: minutes, ordered: ordered, embedUrl: embedUrl };
}));
