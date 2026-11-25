/* TV Home poster previews. The signed-in Jellyfin client resolves local trailers.
 * Normal playback, watch history and subtitle preferences have separate owners. */
(function (root) {
  'use strict';
  if (!root || root.ZorofinTvPreviews) return;
  var doc = root.document, current = null;
  function tv() { return doc.documentElement.classList.contains('layout-tv') || doc.body.classList.contains('layout-tv'); }
  function scope() {
    var c = root.ApiClient;
    try { return c && c.getCurrentUserId() && c.accessToken() ? c.serverId() + ':' + c.getCurrentUserId() : ''; }
    catch (_) { return ''; }
  }
  function enabled() {
    try { return root.localStorage.getItem('zorofin-tv-preview:' + scope()) !== 'off'; }
    catch (_) { return true; }
  }
  function stop() {
    var s = current;
    if (!s) return;
    current = null;
    root.clearTimeout(s.timer); root.clearTimeout(s.guard);
    if (s.video) {
      s.video.pause(); s.video.removeAttribute('src'); s.video.load(); s.video.remove();
    }
    s.card.classList.remove('zoroTvPreview');
  }
  function active(s) {
    return current === s && s.owner === scope() && !doc.hidden && tv() && doc.documentElement.contains(s.card) && s.card.contains(doc.activeElement);
  }
  function eligible(target) {
    if (!tv() || !target || !target.closest) return null;
    var card = target.closest('#homeTab .card[data-id], #homeTab .zoroBrowseCard[data-id]');
    if (!card || !/^(movie|series)$/i.test(card.dataset.type || '')) return null;
    if (card.closest('.ContinueWatchingNextUp,[data-zoro-home-section="continue-watching"],[data-zoro-home-section="sports"],.section0.resume')) return null;
    return card;
  }
  function compatible(src) {
    if (!src || !/(^|,)(mp4|mov|m4v)(,|$)/i.test(src.Container || '')) return false;
    var streams = src.MediaStreams || [], audio = streams.filter(function (s) { return s.Type === 'Audio'; });
    return streams.some(function (s) {
      return s.Type === 'Video' && !s.IsAttachedPic && /^(h264|hevc|h265)$/i.test(s.Codec) && s.Height <= 1080;
    }) && (!audio.length || audio.some(function (s) { return /^(aac|eac3|ac3)$/i.test(s.Codec); }));
  }
  function play(s) {
    if (!active(s) || !root.ZorofinExtras) return;
    var id = s.card.dataset.id, c = root.ApiClient;
    if (!/^[\da-f-]{1,64}$/i.test(id)) return;
    var user = '?userId=' + encodeURIComponent(c.getCurrentUserId());
    root.ZorofinExtras.api('Items/' + id + '/LocalTrailers' + user).then(function (list) {
      var item = Array.isArray(list) && list[0];
      if (!active(s) || !item || !/^[\da-f-]{1,64}$/i.test(item.Id)) return null;
      return item.MediaSources && item.MediaSources.length ? item : root.ZorofinExtras.api('Items/' + item.Id + user + '&fields=MediaSources');
    }).then(function (item) {
      if (!active(s) || !item || !/^[\da-f-]{1,64}$/i.test(item.Id)) return;
      var src = (item.MediaSources || []).filter(compatible)[0];
      var host = s.card.querySelector('.zoroBrowseArtwork,.cardScalable');
      if (!src || !host) return;
      var video = doc.createElement('video');
      var sourceId = String(src.Id || item.Id);
      if (!/^[a-z0-9_-]{1,128}$/i.test(sourceId)) return;
      s.video = video; video.muted = true; video.playsInline = true; video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:0;z-index:1';
      s.card.classList.add('zoroTvPreview');
      host.appendChild(video);
      video.addEventListener('playing', function () { if (active(s)) { root.clearTimeout(s.guard); video.style.opacity = '1'; } });
      function finish() { if (current === s) stop(); }
      video.addEventListener('ended', finish); video.addEventListener('error', finish);
      video.addEventListener('timeupdate', function () { if (!active(s) || video.currentTime >= 30) finish(); });
      s.guard = root.setTimeout(finish, 3000);
      var token = c.accessToken();
      var track = (src.MediaStreams || []).filter(function (m) {
        return m.Type === 'Subtitle' && /^(srt|subrip|vtt|webvtt)$/i.test(m.Codec) && Number.isInteger(m.Index) && m.Index >= 0;
      })[0];
      if (track) {
        var captions = doc.createElement('track');
        captions.kind = 'captions'; captions.srclang = track.Language || 'und'; captions.default = true;
        captions.src = c.getUrl('Videos/' + item.Id + '/' + sourceId + '/Subtitles/' + track.Index + '/0/Stream.vtt', { api_key: token });
        video.appendChild(captions);
      }
      video.src = c.getUrl('Videos/' + item.Id + '/stream.mp4', { static: 'true', mediaSourceId: sourceId, api_key: token });
      var started = video.play(); if (started && started.catch) started.catch(finish);
    }).catch(function () { if (current === s) stop(); });
  }
  function start(card, manual) {
    stop();
    var owner = scope();
    if (!owner || (!manual && !enabled())) return;
    var s = current = { card: card, owner: owner };
    if (manual) play(s); else s.timer = root.setTimeout(function () { play(s); }, 2000);
  }
  doc.addEventListener('focusin', function (e) {
    var card = eligible(e.target);
    if (card && (!current || current.card !== card)) start(card, false);
    else if (!card) stop();
  });
  doc.addEventListener('focusout', function (e) { if (current && !current.card.contains(e.relatedTarget)) stop(); });
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) stop(); });
  root.addEventListener('hashchange', stop); root.addEventListener('pagehide', stop);
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'MediaPlayPause' && [415, 19, 10252].indexOf(e.keyCode) < 0) return;
    var card = eligible(doc.activeElement);
    if (!card) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!current || !current.video) start(card, true);
    else if (current.video.paused) {
      var session = current, resumed = session.video.play();
      if (resumed && resumed.catch) resumed.catch(function () { if (current === session) stop(); });
    }
    else current.video.pause();
  }, true);
  root.ZorofinTvPreviews = { action: function () {
    var owner = scope();
    if (!tv() || !owner) return null;
    return { key: 'home-previews', label: 'Home trailer previews · ' + (enabled() ? 'On' : 'Off'), run: function () {
      if (scope() !== owner) return;
      try { root.localStorage.setItem('zorofin-tv-preview:' + owner, enabled() ? 'off' : 'on'); } catch (_) {}
      stop();
    } };
  } };
}(typeof window === 'undefined' ? null : window));
