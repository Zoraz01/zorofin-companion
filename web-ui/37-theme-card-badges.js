/* Home card badges, like the iOS and Apple TV apps: a star rating chip in the
 * top-right corner and a quality label ("4K · DV") in the bottom-left corner
 * of every Home card, whichever script drew the card. Other badge styles
 * (Jellyfin Enhanced overlays, row-specific chips such as the 4K / HDR
 * showcase pills from the plugin Home rows) and the play button are
 * hidden on Home so every row looks the same. Presentation only. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  // Same rules as ZorofinCore MediaQuality.thumbnailBadges.
  function resolution(stream) {
    var width = Number(stream && stream.Width) || 0, height = Number(stream && stream.Height) || 0;
    if (!width && !height) return null;
    if (width >= 7680 || height >= 4320) return '8K';
    if (width >= 3840 || height >= 2160) return '4K';
    if (width >= 1920 || height >= 1080) return stream.IsInterlaced ? '1080i' : '1080p';
    if (width >= 1280 || height >= 720) return '720p';
    return 'SD';
  }
  function dynamicRange(stream) {
    var type = String(stream && stream.VideoRangeType || '').toUpperCase();
    if (/^DOVI(WITH(HDR10|HLG|SDR|EL|HDR10PLUS|ELHDR10PLUS))?$/.test(type)) return 'Dolby Vision';
    if (type === 'HDR10PLUS') return 'HDR10+';
    if (type === 'HDR10') return 'HDR10';
    if (type === 'HLG') return 'HLG';
    if (type === 'SDR') return 'SDR';
    var range = String(stream && stream.VideoRange || '').toUpperCase();
    return range === 'HDR' ? 'HDR' : range === 'SDR' ? 'SDR' : null;
  }
  function qualityBadges(item) {
    var streams = (item && (item.MediaStreams || (item.MediaSources && item.MediaSources[0] && item.MediaSources[0].MediaStreams))) || [];
    var video = streams.filter(function (s) { return s.Type === 'Video' && !s.IsAttachedPic; })[0];
    if (!video) return [];
    var range = dynamicRange(video);
    return [resolution(video), range === 'SDR' ? null : range === 'Dolby Vision' ? 'DV' : range].filter(Boolean);
  }
  function ratingText(item) {
    var value = Number(item && item.CommunityRating);
    return item && item.CommunityRating != null && isFinite(value) && value > 0 ? value.toFixed(1) : null;
  }

  var CARDS = '#homeTab .card[data-id], #homeTab .zoroBrowseCard[data-id]';
  var CSS = [
    // One badge style everywhere on Home.
    '#homeTab .quality-overlay-container, #homeTab .rating-overlay-container, #homeTab .zoroBrowseRating, #homeTab .zhr-badges, #homeTab .zph-badges { display:none!important; }',
    '#homeTab .cardScalable > .cardOverlayButton-br { display:none!important; }',
    '#homeTab .zcb-host { position:relative; }',
    '.zcb-rating { position:absolute; top:8px; right:8px; z-index:2; display:inline-flex; align-items:center; gap:4px; padding:5px 8px; border-radius:999px; background:rgba(0,0,0,.82); color:#ffd60a; font:700 12px/1 system-ui,-apple-system,sans-serif; white-space:nowrap; pointer-events:none; }',
    '.zcb-quality { position:absolute; left:8px; bottom:8px; z-index:2; padding:4px 7px; border-radius:5px; background:rgba(0,0,0,.82); color:#fff; font:700 10px/1.2 system-ui,-apple-system,sans-serif; white-space:nowrap; pointer-events:none; }',
    '.zcb-host.zcb-progress .zcb-quality { bottom:16px; }',
    '.layout-tv .zcb-rating { top:12px; right:12px; padding:6px 10px; font-size:18px; } .layout-tv .zcb-quality { font-size:16px; }'
  ].join('\n');

  function mount(root) {
    if (!root || root.zorofinCardBadgesLoaded) return;
    root.zorofinCardBadgesLoaded = true;
    var doc = root.document, cache = Object.create(null), pending = Object.create(null), identity = '', scheduled = false;
    var style = doc.createElement('style'); style.id = 'zorofinCardBadgesStyles'; style.textContent = CSS; doc.head.appendChild(style);

    function who() {
      try { var a = root.ApiClient; return a && a.getCurrentUserId() && a.accessToken() ? a.serverId() + ':' + a.getCurrentUserId() : ''; } catch (_) { return ''; }
    }
    function hostFor(card) {
      return card.querySelector('.cardScalable') || card.querySelector('.zoroBrowseArtwork');
    }
    function paint(card, item) {
      var host = hostFor(card);
      if (!host) return;
      var rating = ratingText(item), quality = qualityBadges(item).join(' · ');
      var key = (rating || '') + '|' + quality;
      if (host.getAttribute('data-zcb') === key) return;
      host.setAttribute('data-zcb', key);
      host.classList.add('zcb-host');
      host.classList.toggle('zcb-progress', !!host.querySelector('.itemProgressBar, .cardProgress, progress'));
      Array.prototype.forEach.call(host.querySelectorAll(':scope > .zcb-rating, :scope > .zcb-quality'), function (old) { old.remove(); });
      if (rating) {
        var chip = doc.createElement('span'); chip.className = 'zcb-rating'; chip.setAttribute('aria-hidden', 'true');
        chip.textContent = '★ ' + rating; host.appendChild(chip);
      }
      if (quality) {
        var label = doc.createElement('span'); label.className = 'zcb-quality'; label.setAttribute('aria-hidden', 'true');
        label.textContent = quality; host.appendChild(label);
      }
    }
    function scan() {
      scheduled = false;
      var current = who();
      if (current !== identity) { identity = current; cache = Object.create(null); pending = Object.create(null); }
      if (!identity) return;
      var cards = Array.prototype.slice.call(doc.querySelectorAll(CARDS)), missing = [];
      cards.forEach(function (card) {
        var id = card.getAttribute('data-id');
        if (!id) return;
        if (cache[id]) paint(card, cache[id]);
        else if (!pending[id] && missing.indexOf(id) < 0) missing.push(id);
      });
      if (!missing.length) return;
      missing.forEach(function (id) { pending[id] = true; });
      var source = identity, client = root.ApiClient;
      for (var i = 0; i < missing.length; i += 50) (function (batch) {
        client.getItems(client.getCurrentUserId(), { Ids: batch.join(','), Fields: 'MediaStreams', EnableImages: false, EnableUserData: false, Limit: 50 })
          .then(function (result) {
            if (source !== who()) return;
            (result.Items || []).forEach(function (item) { cache[item.Id] = item; });
            batch.forEach(function (id) { if (!cache[id]) cache[id] = { Id: id }; });
            schedule();
          })
          .catch(function () { batch.forEach(function (id) { delete pending[id]; }); });
      }(missing.slice(i, i + 50)));
    }
    function schedule() { if (!scheduled) { scheduled = true; setTimeout(scan, 150); } }
    new root.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target;
        if (target.nodeType === 1 && (target.closest('.zcb-rating, .zcb-quality') || target.classList.contains('zcb-host'))) continue;
        schedule(); return;
      }
    }).observe(doc.body, { childList: true, subtree: true });
    root.addEventListener('hashchange', schedule);
    schedule();
  }

  return { mount: mount, qualityBadges: qualityBadges, ratingText: ratingText };
}));
