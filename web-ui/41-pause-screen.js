/* Zorofin pause screen and auto-pause, in place of Jellyfin Enhanced's.
 *
 * Pause screen: a few seconds after a video is paused, with nobody touching
 * the mouse, keyboard or remote, the player fades to the title's art with its
 * logo, details, plot and progress. Any input brings the player back; Play
 * resumes as usual.
 * Auto-pause: switching to another browser tab pauses the video, and coming
 * back resumes it, but only if it was auto-paused. The operator can turn
 * auto-pause off in the Dashboard (html.zorofin-off-autopause).
 *
 * The item comes from this device's own Jellyfin session, so it works with
 * Jellyfin's player and the Zorofin player alike. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var DELAY_MS = 5000;

  function clock(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  // The lines under the title: episode code and name, then year, rating and length.
  function lines(item) {
    var first = '', facts = [];
    if (item.Type === 'Episode') {
      var code = item.ParentIndexNumber != null && item.IndexNumber != null ? 'S' + item.ParentIndexNumber + ':E' + item.IndexNumber : '';
      first = [code, item.Name].filter(Boolean).join(' · ');
    }
    if (item.ProductionYear) facts.push(String(item.ProductionYear));
    if (item.OfficialRating) facts.push(item.OfficialRating);
    if (item.CommunityRating) facts.push('★ ' + Number(item.CommunityRating).toFixed(1));
    return { episode: first, facts: facts.join(' · ') };
  }
  function endsAt(now, remainingSeconds) {
    var end = new Date(now.getTime() + Math.max(0, remainingSeconds) * 1000);
    return end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function mount() {
    if (root.ZorofinPauseScreen) return;
    var doc = root.document, html = doc.documentElement;
    var state = { video: null, timer: 0, el: null, autoPaused: false, item: null, itemFor: '', token: 0 };
    root.ZorofinPauseScreen = { version: '1.0.0' };

    function make(tag, cls, text) { var el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
    function playing(video) { return video && !video.paused && !video.ended && video.readyState > 2; }
    function onPlayer() { return /^#\/video(?:[?]|$)/.test(root.location.hash) || Boolean(doc.querySelector('.videoPlayerContainer:not(.hide) video')); }
    function hide() {
      root.clearTimeout(state.timer);
      if (state.el) { var el = state.el; state.el = null; el.classList.remove('zps-on'); root.setTimeout(function () { el.remove(); }, 400); }
    }
    function arm() {
      root.clearTimeout(state.timer);
      hide();
      var v = state.video;
      if (!v || !v.paused || v.ended || !onPlayer()) return;
      state.timer = root.setTimeout(show, DELAY_MS);
    }
    function current() {
      var c = root.ApiClient;
      if (!c) return Promise.resolve(null);
      var key = c.deviceId && c.deviceId();
      return c.getSessions({ deviceId: key }).then(function (sessions) {
        var mine = (sessions || []).filter(function (s) { return s.NowPlayingItem && (!key || s.DeviceId === key); })[0];
        if (!mine) return null;
        var id = mine.NowPlayingItem.Id;
        if (state.item && state.itemFor === id) return state.item;
        return c.getItem(c.getCurrentUserId(), id).then(function (item) { state.item = item; state.itemFor = id; return item; });
      }).then(null, function () { return null; });
    }
    function show() {
      var v = state.video, token = ++state.token;
      if (!v || !v.paused || !onPlayer()) return;
      current().then(function (item) {
        if (token !== state.token || !item || !v.paused || !onPlayer()) return;
        var c = root.ApiClient, el = make('div', 'zoroPauseScreen'), art = make('div', 'zps-art');
        el.setAttribute('aria-hidden', 'true');
        var backdropId = item.BackdropImageTags && item.BackdropImageTags.length ? item.Id : item.ParentBackdropItemId;
        var backdropTag = item.BackdropImageTags && item.BackdropImageTags.length ? item.BackdropImageTags[0] : (item.ParentBackdropImageTags || [])[0];
        if (backdropId && backdropTag) art.style.backgroundImage = 'url("' + c.getImageUrl(backdropId, { type: 'Backdrop', tag: backdropTag, maxWidth: 1920, quality: 80 }) + '")';
        var info = make('div', 'zps-info'), logoId = item.ImageTags && item.ImageTags.Logo ? item.Id : item.ParentLogoItemId;
        var logoTag = item.ImageTags && item.ImageTags.Logo ? item.ImageTags.Logo : item.ParentLogoImageTag;
        if (logoId && logoTag) { var logo = make('img', 'zps-logo'); logo.alt = ''; logo.src = c.getImageUrl(logoId, { type: 'Logo', tag: logoTag, maxWidth: 700 }); info.appendChild(logo); }
        else info.appendChild(make('h2', 'zps-title', item.SeriesName || item.Name));
        var l = lines(item);
        if (l.episode) info.appendChild(make('p', 'zps-episode', l.episode));
        if (l.facts) info.appendChild(make('p', 'zps-facts', l.facts));
        if (item.Overview) info.appendChild(make('p', 'zps-plot', item.Overview));
        var duration = isFinite(v.duration) && v.duration > 0 ? v.duration : (item.RunTimeTicks || 0) / 1e7, at = v.currentTime || 0;
        if (duration > 0) {
          var bar = make('div', 'zps-progress'), fill = make('span');
          fill.style.width = Math.min(100, at / duration * 100).toFixed(1) + '%'; bar.appendChild(fill);
          var times = make('p', 'zps-times', clock(at) + ' of ' + clock(duration) + ' · Ends at ' + endsAt(new Date(), duration - at));
          info.append(bar, times);
        }
        info.appendChild(make('p', 'zps-paused', 'Paused'));
        el.append(art, info);
        doc.body.appendChild(el);
        state.el = el;
        root.requestAnimationFrame(function () { el.classList.add('zps-on'); });
      });
    }
    function attach(video) {
      if (!video || video.dataset.zoroPause) return;
      video.dataset.zoroPause = 'true';
      state.video = video;
      video.addEventListener('pause', function () { state.video = video; arm(); });
      video.addEventListener('play', function () { state.token++; hide(); });
      video.addEventListener('emptied', function () { state.item = null; state.itemFor = ''; });
    }
    // Any input brings the player back (and restarts the wait while paused).
    ['mousemove', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (type) {
      doc.addEventListener(type, function () { if (state.el || state.timer) { state.token++; arm(); } }, { capture: true, passive: true });
    });
    doc.addEventListener('visibilitychange', function () {
      var v = state.video;
      if (!v || !onPlayer() || html.classList.contains('zorofin-off-autopause')) return;
      // Picture-in-picture keeps playing on purpose.
      if (doc.hidden && playing(v) && doc.pictureInPictureElement !== v) { state.autoPaused = true; v.pause(); }
      else if (!doc.hidden && state.autoPaused) { state.autoPaused = false; var p = v.play(); if (p && p.catch) p.catch(function () { /* the browser wants a tap first */ }); }
    });
    root.addEventListener('hashchange', function () { if (!onPlayer()) { state.token++; hide(); state.autoPaused = false; } });
    new MutationObserver(function () { var v = doc.querySelector('.videoPlayerContainer video, video.htmlvideoplayer'); if (v) attach(v); })
      .observe(doc.body, { childList: true, subtree: true });
  }

  return { mount: mount, lines: lines, clock: clock, endsAt: endsAt };
}));
