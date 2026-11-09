/* Zorofin extras: asks the Zorofin plugin once which web extras are on
 * (/Zorofin/Extras) and gives the other scripts a small signed-in fetch helper.
 * The extras replace the Media Bar and Jellyfin Enhanced plugins: banner
 * trailers and hand-picked titles, Downloads, Calendar, ratings, Arr links and
 * Catch Up. Without the plugin (or an older one) every extra stays off. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.ZorofinExtras = root.ZorofinExtras || api;
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var OFF = Object.freeze({ schemaVersion: 0, banner: { itemIds: [], trailers: false, skipIntros: false }, calendar: false, downloads: false, arrLinks: false, ratings: false, catchUp: false, catchUpLog: false });
  var TTL = 5 * 60 * 1000;
  var cache = { key: '', at: 0, value: null };

  function client() { return root && root.ApiClient; }
  function who(c) {
    try { return c && c.getCurrentUserId() && c.accessToken() ? c.serverId() + ':' + c.getCurrentUserId() : ''; } catch (_) { return ''; }
  }
  // GET or POST a plugin route as the signed-in viewer. Resolves to parsed JSON,
  // null for 204/404, and rejects on other failures.
  function api(path, options) {
    var c = client();
    if (!c || !who(c)) return Promise.reject(new Error('signed out'));
    options = options || {};
    var headers = { Accept: 'application/json', Authorization: 'MediaBrowser Token="' + c.accessToken() + '"' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return root.fetch(c.getUrl(path), {
      method: options.method || 'GET', headers: headers, credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }).then(function (r) {
      if (r.status === 204 || r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function normalise(value) {
    if (!value || typeof value !== 'object') return OFF;
    var banner = value.banner || {};
    return {
      schemaVersion: value.schemaVersion || 1,
      banner: {
        itemIds: Array.isArray(banner.itemIds) ? banner.itemIds.filter(function (id) { return /^[0-9a-f]{32}$/i.test(id); }) : [],
        trailers: banner.trailers === true, skipIntros: banner.skipIntros === true
      },
      calendar: value.calendar === true, downloads: value.downloads === true, arrLinks: value.arrLinks === true,
      ratings: value.ratings === true, catchUp: value.catchUp === true, catchUpLog: value.catchUpLog === true
    };
  }
  // The viewer's extras, cached for a few minutes and per signed-in account.
  function get() {
    var key = who(client());
    if (!key) return Promise.resolve(OFF);
    if (cache.key === key && cache.value && Date.now() - cache.at < TTL) return cache.value;
    cache.key = key; cache.at = Date.now();
    cache.value = api('Zorofin/Extras').then(normalise, function () { return OFF; });
    return cache.value;
  }
  function reset() { cache.key = ''; cache.value = null; }
  // The YouTube video id of an item's first YouTube trailer, if any.
  function youTubeId(item) {
    var list = (item && item.RemoteTrailers) || [];
    for (var i = 0; i < list.length; i++) {
      var url = String(list[i] && list[i].Url || ''), m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
      if (m) return m[1];
    }
    return '';
  }
  return { get: get, api: api, reset: reset, normalise: normalise, youTubeId: youTubeId, OFF: OFF };
}));
