/*
 * Zorofin Live TV streams: shows which channels are using the server's Live
 * TV streams, from the companion's liveTvStreams module (through the plugin's
 * /Zorofin/Companion route).
 *
 * - Live TV page: a "Playing now" strip with each channel in use and Join.
 * - Channel cards: an "In use" badge on channels that are playing.
 * - Channel page: a line saying the channel is playing (Join), or which
 *   channel is using the last stream.
 * - Play on a different channel when every stream is busy opens a dialog that
 *   names the channel in use and offers to watch it instead.
 *
 * Viewers only ever see channel names, never who is watching. Any failure
 * (no plugin, no companion module, network) leaves Jellyfin's playback alone.
 */
(function (root) {
  'use strict';

  var VERSION = '1.0.0';
  var POLL_MS = 15000;
  var FRESH_MS = 30000;
  var RETRY_MISSING_MS = 10 * 60 * 1000;

  function plural(count, word) { return count + ' ' + word + (count === 1 ? '' : 's'); }

  // Viewer-facing text for one status, kept here so other clients can copy it.
  function describe(status, channelId) {
    if (!status || !Array.isArray(status.streams)) return null;
    var limit = status.limit, inUse = status.inUse, streams = status.streams;
    var playing = null, i;
    for (i = 0; i < streams.length; i += 1) if (streams[i].channelId === channelId) playing = streams[i];
    var others = streams.filter(function (s) { return s.channelId !== channelId; });
    var names = others.map(function (s) { return s.channelName; }).filter(Boolean);
    if (status.otherUse > 0) names.push(status.otherUse === 1 ? 'another app' : status.otherUse + ' other apps');
    var list = names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    var out = {
      summary: inUse + ' of ' + plural(limit, 'Live TV stream') + ' in use',
      playing: playing,
      full: status.free <= 0,
      channelLine: '',
      blocked: null,
    };
    if (playing) {
      out.channelLine = playing.yours ? 'You’re watching this channel.'
        : 'Already playing' + (playing.viewers > 1 ? ' for ' + playing.viewers + ' people' : '') + '. Joining doesn’t use another stream.';
    } else if (channelId && out.full && list) {
      out.channelLine = (limit === 1 ? list + ' is using the only Live TV stream.' : list + ' are using all ' + limit + ' Live TV streams.');
    }
    if (channelId && !playing && out.full) {
      out.blocked = {
        title: 'Live TV is in use',
        text: list
          ? (limit === 1 ? list + ' is using the only Live TV stream right now.' : list + ' are using all ' + limit + ' Live TV streams right now.')
          : 'Every Live TV stream is in use right now.',
        hint: others.length ? 'You can watch ' + (others.length === 1 ? others[0].channelName : 'one of those channels') + ' instead, or try again when a stream is free.'
          : 'Try again when a stream is free.',
        join: others.length === 1 ? others[0] : null,
      };
    }
    return out;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { VERSION: VERSION, describe: describe };
    return;
  }
  if (!root || !root.document || root.zorofinLiveTvStreams) return;
  root.zorofinLiveTvStreams = VERSION;
  // This replaces an older busy/available notice script (zorofin-live-tv-guard.js).
  if (!root.zorofinLiveTvGuard) root.zorofinLiveTvGuard = 'replaced-by-live-tv-streams';

  var doc = root.document;
  var identity = '', status = null, statusAt = 0, missingUntil = 0, pending = null, serial = 0;
  var channels = null, channelsAt = 0, strip = null, line = null, modal = null, bypass = null, busyClick = false;
  var autoPlay = null;

  function api() {
    var c = root.ApiClient;
    try { return c && c.accessToken && c.accessToken() && c.getCurrentUserId && c.getCurrentUserId() ? c : null; } catch (_) { return null; }
  }
  function serverUrl(c, path, query) {
    if (c.getUrl) return c.getUrl(path, query);
    var qs = query ? '?' + Object.keys(query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&') : '';
    return c.serverAddress().replace(/\/$/, '') + '/' + path + qs;
  }
  function deviceId(c) { try { return typeof c.deviceId === 'function' ? c.deviceId() : ''; } catch (_) { return ''; } }
  function el(tag, className, text) { var e = doc.createElement(tag); if (className) e.className = className; if (text) e.textContent = text; return e; }
  function visible(e) { return !!e && doc.contains(e) && !e.closest('.hide,[hidden]') && e.getClientRects().length > 0; }
  function detailId() { var m = String(root.location.hash).match(/^#\/details\?[^#]*\bid=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  function onLiveTv() { return /^#\/livetv(?:\?|$)/i.test(String(root.location.hash)); }
  function fresh() { return status && Date.now() - statusAt < FRESH_MS; }
  function clean(id) { return String(id || '').replace(/-/g, '').toLowerCase(); }
  function logo(c, id) { return serverUrl(c, 'Items/' + id + '/Images/Primary', { maxHeight: 96, quality: 90 }); }
  function timeLeft(endsAt) {
    var end = Date.parse(endsAt || ''), mins = Math.round((end - Date.now()) / 60000);
    if (!isFinite(mins) || mins <= 0) return '';
    return mins < 60 ? mins + ' min left' : Math.floor(mins / 60) + ' hr ' + (mins % 60 ? (mins % 60) + ' min ' : '') + 'left';
  }

  async function read(channelId) {
    var c = api();
    if (!c || Date.now() < missingUntil) return null;
    var query = { deviceId: deviceId(c) };
    if (channelId) query.channelId = channelId;
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 4000);
    try {
      var response = await root.fetch(serverUrl(c, 'Zorofin/Companion/liveTvStreams/status', query), {
        headers: { Authorization: 'MediaBrowser Token="' + c.accessToken() + '"' }, cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 404) { missingUntil = Date.now() + RETRY_MISSING_MS; return null; }
      if (!response.ok) return null;
      var body = await response.json();
      if (!body || body.version !== 1 || !Array.isArray(body.streams) || !(body.limit > 0)) return null;
      return body;
    } catch (_) { return null; } finally { clearTimeout(timer); }
  }

  async function channelSet(c) {
    if (channels && Date.now() - channelsAt < 300000) return channels;
    try {
      var list = await c.getJSON(serverUrl(c, 'LiveTv/Channels', { UserId: c.getCurrentUserId(), EnableImages: false, Fields: '' }));
      channels = {};
      (list.Items || []).forEach(function (item) { channels[clean(item.Id)] = true; });
      channelsAt = Date.now();
    } catch (_) { channels = channels || {}; }
    return channels;
  }

  function play(stream) {
    var c = api();
    if (!c) return;
    autoPlay = { id: clean(stream.channelId), until: Date.now() + 8000 };
    root.location.hash = '#/details?id=' + encodeURIComponent(stream.channelId) + '&serverId=' + encodeURIComponent(c.serverId ? c.serverId() : '');
  }

  // After "Watch ESPN", press the channel page's own Play once it appears.
  function maybeAutoPlay() {
    if (!autoPlay || Date.now() > autoPlay.until || clean(detailId()) !== autoPlay.id) return;
    var page = doc.querySelector('#itemDetailPage:not(.hide)');
    var button = page && page.querySelector('.mainDetailButtons .btnPlay, .mainDetailButtons .zoroLiveTvPlayButton');
    if (!visible(button)) return;
    autoPlay = null; bypass = button;
    try { button.click(); } finally { bypass = null; }
  }

  function renderStrip(c) {
    // Jellyfin 10.x: #liveTvSuggestedPage with tab panels. Jellyfin 12: #liveTvPage, sections directly inside.
    var legacy = onLiveTv() && doc.querySelector('#liveTvSuggestedPage:not(.hide)');
    var page12 = !legacy && onLiveTv() && doc.querySelector('#liveTvPage:not(.hide)');
    // Jellyfin 12's guide is absolutely positioned over the page; inside it the strip sits above the dates instead of under them.
    var guide = page12 && page12.querySelector('.tvguide');
    var anchor = legacy ? Array.prototype.find.call(legacy.querySelectorAll('.pageTabContent:not(.hide)'), visible)
      : visible(guide) ? guide : page12;
    if (!visible(anchor) || !fresh() || !status.streams.length) { if (strip) strip.remove(); strip = null; return; }
    if (!strip) { strip = el('section', 'zls-strip'); strip.setAttribute('aria-label', 'Playing now on Live TV'); }
    if (strip.parentNode !== anchor || anchor.firstChild !== strip) anchor.insertBefore(strip, anchor.firstChild);
    var key = JSON.stringify([status.streams, status.limit, status.inUse, status.otherUse]);
    if (strip.dataset.key === key) return;
    strip.dataset.key = key;
    var info = describe(status, '');
    var row = el('div', 'zls-row');
    status.streams.forEach(function (stream) {
      var card = el('div', 'zls-card' + (stream.yours ? ' zls-yours' : ''));
      var art = el('div', 'zls-logo');
      var img = el('img'); img.alt = ''; img.loading = 'lazy'; img.src = logo(c, stream.channelId);
      img.onerror = function () { img.remove(); art.textContent = (stream.channelName || '?').slice(0, 3).toUpperCase(); };
      art.appendChild(img);
      var text = el('div', 'zls-text');
      var name = el('div', 'zls-name');
      name.appendChild(el('span', 'zls-live', 'LIVE'));
      name.appendChild(el('span', 'zls-channel', stream.channelName || 'Channel ' + (stream.channelNumber || '')));
      text.appendChild(name);
      if (stream.programme && stream.programme.title) text.appendChild(el('div', 'zls-programme', stream.programme.title));
      var meta = [stream.viewers > 1 ? stream.viewers + ' watching' : '1 watching', stream.programme ? timeLeft(stream.programme.endsAt) : ''].filter(Boolean).join(' · ');
      text.appendChild(el('div', 'zls-meta', meta));
      var button = el('button', 'zls-join' + (stream.yours ? ' zls-join-yours' : ''), stream.yours ? 'Watching' : 'Join');
      button.type = 'button';
      button.setAttribute('aria-label', (stream.yours ? 'You are watching ' : 'Join ') + (stream.channelName || 'this channel'));
      button.addEventListener('click', function () { play(stream); });
      card.appendChild(art); card.appendChild(text); card.appendChild(button);
      row.appendChild(card);
    });
    var foot = el('p', 'zls-foot', info.summary + '. ' + (info.full
      ? 'Anyone can join a channel that’s already playing.'
      : plural(status.free, 'stream') + ' free for another channel.'));
    strip.replaceChildren(row, foot);
  }

  // The live channel a card stands for: a channel card, or a programme card that is on air now.
  function cardChannel(card) {
    if (!channels) return '';
    if (card.getAttribute('data-type') === 'Program') {
      var start = Date.parse(card.getAttribute('data-startdate') || ''), end = Date.parse(card.getAttribute('data-enddate') || ''), now = Date.now();
      if (!(start <= now && now < end)) return '';
      var channel = clean(card.getAttribute('data-channelid'));
      return channels[channel] ? channel : '';
    }
    var id = clean(card.getAttribute('data-id'));
    return channels[id] ? id : '';
  }

  function renderBadges() {
    var playing = {};
    if (fresh()) status.streams.forEach(function (s) { playing[clean(s.channelId)] = s; });
    Array.prototype.forEach.call(doc.querySelectorAll('.card[data-id]'), function (card) {
      var id = cardChannel(card);
      if (!id) return;
      var on = playing[id];
      var badge = card.querySelector(':scope .zls-badge');
      if (!on) { if (badge) badge.remove(); return; }
      var host = card.querySelector('.cardImageContainer, .cardScalable') || card;
      if (!badge) { badge = el('span', 'zls-badge'); host.appendChild(badge); }
      var text = on.yours ? 'You’re watching' : 'In use';
      if (badge.textContent !== text) badge.textContent = text;
    });
  }

  function renderLine(c) {
    var id = detailId(), page = doc.querySelector('#itemDetailPage');
    var anchor = page && page.querySelector('.mainDetailButtons');
    var info = channels && channels[clean(id)] && fresh() ? describe(status, clean(id)) : null;
    if (!visible(anchor) || !info || !info.channelLine) { if (line) line.remove(); line = null; return; }
    if (!line) { line = el('div', 'zls-line'); line.setAttribute('role', 'status'); }
    if (line.previousSibling !== anchor) anchor.parentNode.insertBefore(line, anchor.nextSibling);
    var key = info.channelLine + (info.blocked && info.blocked.join ? info.blocked.join.channelId : '');
    if (line.dataset.key === key) return;
    line.dataset.key = key;
    var parts = [el('span', 'zls-dot' + (info.playing ? '' : ' zls-dot-busy')), el('span', 'zls-line-text', info.channelLine)];
    if (info.blocked && info.blocked.join) {
      var join = el('button', 'zls-line-join', 'Watch ' + info.blocked.join.channelName);
      join.type = 'button';
      join.addEventListener('click', function () { play(info.blocked.join); });
      parts.push(join);
    }
    line.replaceChildren.apply(line, parts);
  }

  function render() {
    var c = api();
    if (!c) return;
    renderStrip(c); renderBadges(); renderLine(c); maybeAutoPlay();
  }

  function closeModal() {
    if (!modal) return;
    var previous = modal.previous; modal.element.remove(); modal = null;
    if (previous && doc.contains(previous)) previous.focus();
  }
  function showModal(blocked) {
    closeModal();
    var previous = doc.activeElement, overlay = el('div', 'zls-overlay'), panel = el('section', 'zls-dialog');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'zls-dialog-title');
    var title = el('h2', '', blocked.title); title.id = 'zls-dialog-title';
    panel.appendChild(title);
    if (blocked.join) {
      var c = api(), stream = blocked.join, now = el('div', 'zls-dialog-now');
      var art = el('div', 'zls-logo'), img = el('img'); img.alt = ''; img.src = logo(c, stream.channelId);
      img.onerror = function () { img.remove(); art.textContent = (stream.channelName || '?').slice(0, 3).toUpperCase(); };
      art.appendChild(img);
      var text = el('div', 'zls-text'), name = el('div', 'zls-name');
      name.appendChild(el('span', 'zls-live', 'LIVE')); name.appendChild(el('span', 'zls-channel', stream.channelName));
      text.appendChild(name);
      if (stream.programme && stream.programme.title) text.appendChild(el('div', 'zls-programme', stream.programme.title));
      now.appendChild(art); now.appendChild(text);
      panel.appendChild(now);
    }
    panel.appendChild(el('p', '', blocked.text));
    panel.appendChild(el('p', 'zls-muted', blocked.hint));
    var actions = el('div', 'zls-actions'), buttons = [];
    if (blocked.join) {
      var watch = el('button', 'zls-primary', 'Watch ' + blocked.join.channelName); watch.type = 'button';
      watch.addEventListener('click', function () { var s = blocked.join; closeModal(); play(s); });
      buttons.push(watch);
    }
    var close = el('button', blocked.join ? 'zls-secondary' : 'zls-primary', blocked.join ? 'Not now' : 'OK'); close.type = 'button';
    close.addEventListener('click', closeModal);
    buttons.push(close);
    buttons.forEach(function (b) { actions.appendChild(b); });
    panel.appendChild(actions);
    overlay.appendChild(panel);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    doc.body.appendChild(overlay);
    modal = { element: overlay, previous: previous, buttons: buttons };
    buttons[0].focus();
  }

  async function refresh() {
    var c = api();
    if (!c) { identity = ''; status = null; return; }
    var key = (c.serverId ? c.serverId() : '') + ':' + c.getCurrentUserId() + ':' + c.accessToken();
    if (key !== identity) { identity = key; status = null; channels = null; missingUntil = 0; serial += 1; }
    var hash = String(root.location.hash);
    if (doc.hidden || !/^#\/(?:livetv|details|home|tv|movies|list)/i.test(hash)) { render(); return; }
    if (pending) return pending;
    var epoch = serial;
    pending = (async function () {
      await channelSet(c);
      var id = detailId(), channelId = channels && channels[clean(id)] ? clean(id) : '';
      var data = await read(channelId);
      if (epoch !== serial) return;
      if (data) { status = data; statusAt = Date.now(); }
    })().finally(function () { pending = null; render(); });
    return pending;
  }

  function playTarget(button) {
    var owner = button.closest('.card[data-id]');
    var id = owner ? cardChannel(owner) : '';
    if (id) return id;
    var detail = clean(detailId());
    return button.closest('#itemDetailPage .mainDetailButtons') && channels && channels[detail] ? detail : '';
  }

  doc.addEventListener('click', async function (event) {
    var button = event.target.closest && event.target.closest('.btnPlay,.zoroLiveTvPlayButton,[data-action="play"],[data-action="resume"]');
    if (!button || bypass === button || Date.now() < missingUntil) return;
    var channelId = playTarget(button);
    if (!channelId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busyClick) return;
    busyClick = true;
    var data = null;
    try { data = await read(channelId); } finally { busyClick = false; }
    if (data) { status = data; statusAt = Date.now(); render(); }
    var info = data && describe(data, channelId);
    var canStart = !data || !data.request || data.request.canStart !== false;
    if (info && info.blocked && !canStart) { showModal(info.blocked); return; }
    if (!doc.contains(button)) return;
    bypass = button;
    try { button.click(); } finally { bypass = null; }
  }, true);

  doc.addEventListener('keydown', function (event) {
    if (!modal) return;
    if (event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 461 || event.keyCode === 10009) {
      event.preventDefault(); event.stopImmediatePropagation(); closeModal();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      var list = modal.buttons, at = list.indexOf(doc.activeElement);
      list[(at + (event.shiftKey ? list.length - 1 : 1)) % list.length].focus();
    }
  }, true);

  function routeChange() { closeModal(); void refresh(); }
  root.addEventListener('hashchange', routeChange);
  doc.addEventListener('viewshow', function () { void refresh(); setTimeout(render, 300); });
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) void refresh(); });
  var queued = false;
  new root.MutationObserver(function () {
    if (queued || !(status || autoPlay)) return;
    queued = true;
    root.requestAnimationFrame(function () { queued = false; render(); });
  }).observe(doc.body, { childList: true, subtree: true });
  setInterval(function () { void refresh(); }, POLL_MS);
  void refresh();
})(typeof window !== 'undefined' ? window : null);
