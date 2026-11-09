/* Zorofin server messages: the server's announcement, shown in Notifications
 * rather than as a banner. It reads the Zorofin plugin's /Zorofin/Announcement
 * feed (the reference server's receiver feed has the same shape), so the apps can show
 * the same message and share one "read" state per account.
 *
 * This script only fetches and remembers. The Notifications panel in
 * zorofin-shell.js lists the message and counts it in the green unread badge
 * on the Notifications button. Text only ever goes in through textContent, and links
 * are limited to this server or https. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var VERSION = '3.0.0', REFRESH_MS = 5 * 60 * 1000;
  var TYPES = ['info', 'success', 'warning', 'maintenance'];
  var PENDING = 'zorofin-server-messages:';

  function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
  function safeHref(value) {
    if (typeof value !== 'string') return '';
    var href = value.trim();
    if (/^\/(?![\/\\])/.test(href) && !/[\u0000-\u001f\\]/.test(href)) return href;
    if (/^https:\/\/[^\s\/@]+(?:[\/?#][^\s]*)?$/i.test(href)) return href;
    return '';
  }
  // The same rules as the plugin and the receiver. Anything off shows nothing.
  function validate(input, now) {
    if (!input || input.enabled !== true) return null;
    var id = text(input.id, 80), title = text(input.title, 80), message = text(input.message, 320);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !title || !message) return null;
    var t = now == null ? Date.now() : Number(now), start = input.startAt ? Date.parse(input.startAt) : null, end = input.endAt ? Date.parse(input.endAt) : null;
    if ((input.startAt && !isFinite(start)) || (input.endAt && !isFinite(end)) || (start != null && t < start) || (end != null && t >= end)) return null;
    var action = input.action && typeof input.action === 'object' ? { label: text(input.action.label, 40), href: safeHref(input.action.href) } : null;
    return {
      id: id, title: title, message: message,
      type: TYPES.indexOf(input.type) >= 0 ? input.type : 'info',
      dismissible: input.dismissible !== false,
      dismissed: input.dismissed === true,
      action: action && action.label && action.href ? action : null
    };
  }

  function mount() {
    var doc = root.document;
    if (root.ZorofinServerMessages) return;
    var state = { data: null, key: '', at: 0, pending: null };

    function client() { return root.ApiClient; }
    function user() { try { var c = client(); return c && c.accessToken() && c.getCurrentUserId() ? String(c.getCurrentUserId()) : ''; } catch (_) { return ''; } }
    function token() { try { return client().accessToken() || ''; } catch (_) { return ''; } }
    // The plugin's feed, or the reference server's receiver where the page opts in.
    function feed(dismiss) {
      if (root.ZorofinAnnouncementSource === 'receiver') return '/support/announcement' + (dismiss ? '/dismiss' : '/me');
      var c = client(), p = '/Zorofin/Announcement' + (dismiss ? '/Dismiss' : '');
      return c && c.getUrl ? c.getUrl(p) : p;
    }
    function call(method, url, body) {
      return root.fetch(url, { method: method, cache: 'no-store', redirect: 'error', headers: { Authorization: 'MediaBrowser Token="' + token() + '"', 'X-Jellyfin-Token': token(), 'X-Zorofin-Announcement-Client': VERSION, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    }
    function pendingKey(id) { return PENDING + user() + ':' + id; }
    function locallyRead(id) { try { return Boolean(root.localStorage.getItem(pendingKey(id))); } catch (_) { return false; } }
    function remember(id, value) { try { if (value) root.localStorage.setItem(pendingKey(id), value); else root.localStorage.removeItem(pendingKey(id)); } catch (_) { /* private mode */ } }

    function mark() {
      var a = state.data, unread = Boolean(a && !a.dismissed && state.key === user());
      var html = doc.documentElement;
      if (unread) { html.setAttribute('data-zoro-server-message', 'unread'); }
      else html.removeAttribute('data-zoro-server-message');
      try { root.dispatchEvent(new root.CustomEvent('zorofin:server-message', { detail: { unread: unread } })); } catch (_) { /* old engines */ }
    }

    function send(id) {
      return call('POST', feed(true), { id: id }).then(function (r) { if (r && (r.dismissed || r.ok || r.current === false)) remember(id, ''); return true; }, function () { return false; });
    }
    // The current message for the signed-in viewer, or null.
    function current(force) {
      var who = user();
      if (!who) return Promise.resolve(null);
      if (!force && who === state.key && Date.now() - state.at < REFRESH_MS) return Promise.resolve(state.data);
      if (state.pending && state.pending.who === who) return state.pending.promise;
      var promise = call('GET', feed(false)).then(function (raw) {
        if (user() !== who) return null;
        state.key = who; state.at = Date.now(); state.data = validate(raw);
        var a = state.data;
        // Read while offline: sent now, since the server is the record across devices.
        if (a && !a.dismissed && locallyRead(a.id)) { a.dismissed = true; send(a.id); }
        mark();
        return a;
      }, function (error) { if (user() === who) { state.at = Date.now(); mark(); } throw error; });
      state.pending = { who: who, promise: promise };
      var clear = function () { if (state.pending && state.pending.promise === promise) state.pending = null; };
      promise.then(clear, clear);
      return promise;
    }
    // Marks the message read for this account on every device.
    function dismiss(id) {
      var a = state.data;
      if (!a || a.id !== id || !a.dismissible) return Promise.resolve(false);
      a.dismissed = true; remember(id, 'pending'); mark();
      return send(id);
    }
    function refresh() { current(false).catch(function () { /* tried again later */ }); }

    root.ZorofinServerMessages = { version: VERSION, current: current, dismiss: dismiss, unread: function () { return Boolean(state.data && !state.data.dismissed && state.key === user()); } };
    root.setTimeout(refresh, 900);
    root.addEventListener('hashchange', function () { root.setTimeout(refresh, 0); });
    doc.addEventListener('viewshow', refresh);
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) refresh(); });
  }

  return { VERSION: VERSION, validate: validate, safeHref: safeHref, mount: mount };
}));
