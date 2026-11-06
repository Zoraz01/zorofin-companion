/* Zorofin web player: the apps' player layout on top of Jellyfin web's own
 * video player. Back and the title along the top, Back / Play-Pause / Forward
 * in the middle, the timeline with elapsed and remaining time, then Quality,
 * Audio & subtitles and Playback info, like NativePlayer.swift on iPhone.
 *
 * Jellyfin keeps playback: streaming, transcoding, tracks, subtitles, quality
 * and watch progress. Every Zorofin control drives Jellyfin's own (hidden)
 * control or menu, and the controls show and hide when Jellyfin's do, so
 * keyboard, remote and touch behave exactly as they do without Zorofin.
 * Served by the companion's webUi module; delete this file to restore
 * Jellyfin's own player layout. Written against jellyfin-web 12.4. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  // "1:02:03" / "2:03" / "-12:00" -> seconds (sign kept); null if unreadable.
  function parseClock(text) {
    var value = String(text || '').trim(), negative = /^[-−]/.test(value);
    value = value.replace(/^[-−]\s*/, '');
    if (!/^\d+(:\d{1,2}){1,2}$/.test(value)) return null;
    var seconds = value.split(':').reduce(function (total, part) { return total * 60 + Number(part); }, 0);
    return negative ? -seconds : seconds;
  }
  function formatClock(seconds) {
    seconds = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  // Jellyfin's duration text shows the runtime, or "-remaining" when the
  // viewer has toggled it. Returns {elapsed, remaining} in seconds, or null.
  function times(positionText, durationText) {
    var position = parseClock(positionText), duration = parseClock(durationText);
    if (position === null || duration === null) return null;
    if (duration < 0) return { elapsed: position, remaining: -duration, total: position - duration };
    return { elapsed: position, remaining: Math.max(0, duration - position), total: duration };
  }
  // Material icon for a skip length in seconds (Jellyfin's font has 5/10/30).
  function skipIcon(direction, seconds) {
    var named = { 5: 1, 10: 1, 30: 1 };
    return named[seconds] ? (direction < 0 ? 'replay_' : 'forward_') + seconds : (direction < 0 ? 'replay' : 'forward');
  }

  var CSS = [
    'html.zp-on #videoOsdPage .videoOsdBottom-maincontrols{opacity:0!important;pointer-events:none!important;}',
    'html.zp-on .skinHeader.osdHeader{opacity:0!important;pointer-events:none!important;}',
    'html.zp-picking .actionSheet{opacity:0!important;pointer-events:none!important;}',
    '#zoroPlayer{position:fixed;inset:0;z-index:2;pointer-events:none;color:#fff;font-family:inherit;transition:opacity .25s ease;}',
    '#zoroPlayer.zp-hidden{opacity:0;}#zoroPlayer.zp-hidden *{pointer-events:none!important;}',
    '#zoroPlayer .zp-shade{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.6),transparent 22%,transparent 62%,rgba(0,0,0,.75));}',
    '#zoroPlayer button{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:999px;padding:0;}',
    '#zoroPlayer button:focus-visible{outline:3px solid #fff;outline-offset:2px;}',
    '#zoroPlayer button[disabled]{opacity:.35;cursor:default;}',
    '#zoroPlayer .material-icons{font-size:inherit;line-height:1;}',
    '.zp-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 0 max(8px,env(safe-area-inset-left));}',
    '.zp-back{width:44px;height:44px;font-size:24px;}',
    '.zp-title{font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
    '.zp-transport{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:38px;}',
    '.zp-skip{width:64px;height:64px;font-size:44px;}',
    // Subtitles move up out of the way while the controls show, as on iOS.
    'html.zp-on .videoSubtitles{transition:transform .25s ease;}html.zp-on.zp-controls .videoSubtitles{transform:translateY(-96px);}',
    'html.layout-tv.zp-on.zp-controls .videoSubtitles{transform:translateY(-150px);}',
    '.zp-play{width:72px;height:72px;font-size:46px;background:rgba(255,255,255,.14)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
    '.zp-bottom{position:absolute;left:0;right:0;bottom:0;padding:0 max(16px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));}',
    '.zp-progress{display:flex;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums;color:rgba(255,255,255,.85);}',
    '.zp-progress span{flex:none;min-width:3.2em;}.zp-progress span:last-child{text-align:right;}',
    '.zp-timeline{flex:1;min-width:100px;height:28px;margin:0;pointer-events:auto;accent-color:#fff;background:transparent;cursor:pointer;}',
    '.zp-timeline[disabled]{cursor:default;opacity:.5;}',
    '.zp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;min-height:44px;}',
    '.zp-live{display:none;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.85);}',
    '.zp-live b{display:inline-flex;align-items:center;gap:6px;color:#3ddc84;font-weight:600;}',
    '.zp-live b::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;}',
    '#zoroPlayer.zp-is-live .zp-live{display:inline-flex;}#zoroPlayer.zp-is-live .zp-skip{display:none;}',
    '.zp-tools{display:flex;align-items:center;gap:8px;margin-left:auto;}',
    '.zp-tool{width:44px;height:44px;font-size:24px;}.zp-tool.hide{display:none!important;}',
    '.zp-menu{position:fixed;z-index:100001;min-width:200px;padding:8px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:var(--zoro-graphite,#101411);color:#f4f8f5;box-shadow:0 22px 70px rgba(0,0,0,.6);}',
    '.zp-item{display:block;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}',
    '.zp-item:hover,.zp-item:focus{background:#19211c;outline:none;}.zp-item:focus-visible{outline:3px solid #fff;outline-offset:-3px;}',
    '.layout-tv .zp-top{padding:32px 48px 0;}.layout-tv .zp-back{width:64px;height:64px;font-size:34px;}.layout-tv .zp-title{font-size:28px;}',
    '.layout-tv .zp-transport{gap:36px;}.layout-tv .zp-skip{width:72px;height:72px;font-size:44px;}.layout-tv .zp-play{width:84px;height:84px;font-size:54px;}',
    '.layout-tv .zp-bottom{padding:0 48px 32px;}.layout-tv .zp-progress,.layout-tv .zp-live{font-size:18px;}.layout-tv .zp-tool{width:64px;height:64px;font-size:32px;}',
    '.layout-tv .zp-item{min-height:56px;font-size:1.1em;}',
    // Jellyfin Mobile's native video player: hide browsing chrome while it shows.
    'html.zp-expo-video #zoroGlobalNav,html.zp-expo-video .skinHeader,html.zp-expo-video header.MuiAppBar-root{visibility:hidden!important;}'
  ].join('\n');

  function mount(root) {
    if (!root || root.zorofinPlayerLoaded) return;
    root.zorofinPlayerLoaded = true;
    var doc = root.document, html = doc.documentElement, ui = null, page = null, timer = null, menu = null, scrubbing = false;
    var sheetTrigger = null, closingSheet = null;
    // While the old Injector "Zorofin player options" still runs, it owns the
    // Escape and native-player handling below; don't do them twice.
    var optionsScript = function () { return !!root.zorofinPlayerOptionsLoaded; };
    function ensureStyles() {
      if (doc.getElementById('zoroPlayerStyles')) return;
      var style = doc.createElement('style'); style.id = 'zoroPlayerStyles'; style.textContent = CSS; doc.head.appendChild(style);
    }

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function icon(name) { var i = el('span', 'material-icons ' + name); i.setAttribute('aria-hidden', 'true'); return i; }
    function button(className, label, iconName, action) {
      var b = el('button', className); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      b.appendChild(icon(iconName));
      b.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); action(b); });
      return b;
    }
    function native(selector) { return page && page.querySelector(selector); }
    function visible(node) { return !!node && !node.classList.contains('hide'); }
    // After playback ends Jellyfin's controls stay in the page for a moment, but
    // their handlers have no player any more and throw.
    function hasPlayer() { return !!doc.querySelector('.videoPlayerContainer video, video.htmlvideoplayer'); }
    function press(selector) { var n = native(selector); if (n && !n.disabled && hasPlayer()) n.click(); }
    function skipSeconds(kind) {
      // Jellyfin stores the viewer's skip lengths (ms) per user in localStorage.
      try {
        var id = root.ApiClient && root.ApiClient.getCurrentUserId && root.ApiClient.getCurrentUserId();
        var ms = Number(root.localStorage.getItem((id ? id + '-' : '') + kind));
        if (ms > 0) return Math.round(ms / 1000);
      } catch (_) { /* storage blocked: use Jellyfin's defaults */ }
      return kind === 'skipBackLength' ? 10 : 30;
    }

    // ---- menus: reuse Jellyfin's own pickers -------------------------------
    function closeMenu(restore) {
      if (!menu) return;
      var trigger = menu.trigger;
      menu.node.remove(); doc.removeEventListener('keydown', menu.keys, true); doc.removeEventListener('click', menu.outside, true);
      menu = null;
      if (restore !== false && trigger && trigger.isConnected) trigger.focus();
    }
    function pickFromSettings(menuId) {
      var gear = native('.btnVideoOsdSettings');
      if (!gear || !hasPlayer()) return;
      html.classList.add('zp-picking');
      gear.click();
      var started = Date.now();
      (function look() {
        var item = doc.querySelector('.actionSheet .actionSheetMenuItem[data-id="' + menuId + '"]');
        if (item) { html.classList.remove('zp-picking'); item.click(); return; }
        // Not offered (for example quality on a direct-play-only account):
        // show Jellyfin's settings sheet as it is.
        if (Date.now() - started > 1500) { html.classList.remove('zp-picking'); return; }
        root.setTimeout(look, 30);
      }());
    }
    function trackChoices() {
      var list = [];
      if (visible(native('.btnAudio'))) list.push({ label: 'Audio', selector: '.btnAudio' });
      if (visible(native('.btnSubtitles'))) list.push({ label: 'Subtitles', selector: '.btnSubtitles' });
      return list;
    }
    function showTracks(trigger) {
      var choices = trackChoices();
      if (!choices.length) return;
      if (menu && menu.trigger === trigger) { closeMenu(); return; }
      closeMenu(false);
      if (choices.length === 1) { press(choices[0].selector); return; }
      var node = el('div', 'zp-menu');
      node.setAttribute('role', 'menu'); node.setAttribute('aria-label', 'Audio & subtitles');
      choices.forEach(function (choice) {
        var item = el('button', 'zp-item', choice.label);
        item.type = 'button'; item.setAttribute('role', 'menuitem');
        item.addEventListener('click', function () { closeMenu(false); press(choice.selector); });
        node.appendChild(item);
      });
      doc.body.appendChild(node);
      var rect = trigger.getBoundingClientRect();
      node.style.left = Math.min(Math.max(8, rect.left + rect.width / 2 - node.offsetWidth / 2), root.innerWidth - node.offsetWidth - 8) + 'px';
      node.style.top = Math.max(8, rect.top - node.offsetHeight - 8) + 'px';
      function keys(event) {
        var items = Array.prototype.slice.call(node.querySelectorAll('.zp-item')), at = items.indexOf(doc.activeElement);
        if (event.key === 'Escape' || event.key === 'GoBack' || event.key === 'BrowserBack' || event.keyCode === 461) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          items[event.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1)].focus();
        }
      }
      function outside(event) { if (!node.contains(event.target) && event.target !== trigger) closeMenu(false); }
      doc.addEventListener('keydown', keys, true);
      doc.addEventListener('click', outside, true);
      menu = { node: node, trigger: trigger, keys: keys, outside: outside };
      node.querySelector('.zp-item').focus();
    }

    // ---- build ---------------------------------------------------------------
    function build() {
      var box = el('div'); box.id = 'zoroPlayer'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Player controls');
      box.appendChild(el('div', 'zp-shade'));
      var top = el('div', 'zp-top');
      top.appendChild(button('zp-back', 'Back', 'arrow_back_ios_new', function () {
        var back = doc.querySelector('.skinHeader .headerBackButton');
        if (back) back.click(); else root.history.back();
      }));
      var title = el('div', 'zp-title'); title.setAttribute('aria-live', 'polite'); top.appendChild(title);
      box.appendChild(top);

      var transport = el('div', 'zp-transport');
      var back = skipSeconds('skipBackLength'), forward = skipSeconds('skipForwardLength');
      transport.appendChild(button('zp-skip zp-rewind', 'Back ' + back + ' seconds', skipIcon(-1, back), function () { press('.btnRewind'); }));
      transport.appendChild(button('zp-play', 'Pause', 'pause', function () { press('.btnPause'); }));
      transport.appendChild(button('zp-skip zp-forward', 'Forward ' + forward + ' seconds', skipIcon(1, forward), function () { press('.btnFastForward'); }));
      box.appendChild(transport);

      var bottom = el('div', 'zp-bottom'), progress = el('div', 'zp-progress');
      var elapsed = el('span', 'zp-elapsed', '--:--'), remaining = el('span', 'zp-remaining', '--:--');
      var line = el('input', 'zp-timeline'); line.type = 'range'; line.min = '0'; line.max = '100'; line.step = '0.01'; line.value = '0';
      line.setAttribute('aria-label', 'Playback position');
      line.addEventListener('input', function () { scrubbing = true; preview(); });
      line.addEventListener('change', function () {
        var slider = native('.osdPositionSlider');
        scrubbing = false;
        if (!slider || slider.disabled) return;
        slider.value = line.value;
        slider.dispatchEvent(new root.Event('change', { bubbles: true }));
      });
      progress.appendChild(elapsed); progress.appendChild(line); progress.appendChild(remaining);
      bottom.appendChild(progress);

      var row = el('div', 'zp-row'), live = el('div', 'zp-live');
      live.appendChild(el('b', null, 'Live')); live.appendChild(el('span', 'zp-live-times'));
      row.appendChild(live);
      var tools = el('div', 'zp-tools');
      tools.appendChild(button('zp-tool zp-quality', 'Quality', 'tune', function () { closeMenu(false); pickFromSettings('quality'); }));
      tools.appendChild(button('zp-tool zp-tracks', 'Audio & subtitles', 'subtitles', showTracks));
      tools.appendChild(button('zp-tool zp-info', 'Playback info', 'info', function () { closeMenu(false); pickFromSettings('stats'); }));
      tools.appendChild(button('zp-tool zp-fullscreen', 'Full screen', 'fullscreen', function () { press('.btnFullscreen'); }));
      row.appendChild(tools);
      bottom.appendChild(row);
      box.appendChild(bottom);

      // Jellyfin's video page treats a pointerdown outside .videoOsdBottom as a
      // press on the video: play/pause after 300 ms with a mouse, hide the
      // controls on touch. Keep presses on our controls to ourselves. Pointer
      // moves and keys still reach Jellyfin, so its idle timer keeps working.
      box.addEventListener('pointerdown', function (event) {
        if (event.target.closest && event.target.closest('button, input')) event.stopPropagation();
      });
      return { box: box, title: title, line: line, elapsed: elapsed, remaining: remaining, liveTimes: live.lastChild,
        play: transport.children[1], rewind: transport.children[0], forward: transport.children[2],
        tracks: tools.querySelector('.zp-tracks'), quality: tools.querySelector('.zp-quality'), fullscreen: tools.querySelector('.zp-fullscreen') };
    }
    function preview() {
      var t = times(textOf('.osdPositionText'), textOf('.osdDurationText'));
      if (!t || !t.total) return;
      var at = Number(ui.line.value) / 100 * t.total;
      ui.elapsed.textContent = formatClock(at);
      ui.remaining.textContent = '−' + formatClock(t.total - at);
    }
    // Subtitles drawn by the browser itself (desktop: native text tracks) can't
    // be moved with CSS, so place the current cues a few lines higher while
    // the controls show, and put them back after.
    var cueLines = new WeakMap();
    function liftCues(lift) {
      var videos = doc.querySelectorAll('video');
      for (var v = 0; v < videos.length; v++) {
        var video = videos[v], tracks = video.textTracks || [];
        for (var t = 0; t < tracks.length; t++) {
          var track = tracks[t], cues = track.mode === 'showing' && track.cues;
          if (!cues) continue;
          for (var c = 0; c < cues.length; c++) {
            var cue = cues[c];
            if (!('line' in cue) || cue.startTime > video.currentTime || cue.endTime < video.currentTime) continue;
            var saved = cueLines.get(cue);
            if (lift && !saved) {
              cueLines.set(cue, { line: cue.line, snap: cue.snapToLines });
              cue.snapToLines = true; cue.line = -4;
            } else if (!lift && saved) {
              cue.snapToLines = saved.snap; cue.line = saved.line; cueLines.delete(cue);
            }
          }
        }
      }
    }
    function textOf(selector) { var n = native(selector); return n ? n.textContent : ''; }

    // ---- sync from Jellyfin's controls ------------------------------------------
    function sync() {
      if (!ui || !page) return;
      var bottom = native('.videoOsdBottom-maincontrols');
      var hidden = !bottom || bottom.classList.contains('videoOsdBottom-hidden') || bottom.classList.contains('hide');
      ui.box.classList.toggle('zp-hidden', hidden);
      html.classList.toggle('zp-controls', !hidden);
      liftCues(!hidden);
      if (hidden && menu) closeMenu(false);

      var titleNode = doc.querySelector('.skinHeader .pageTitle');
      var title = (titleNode && titleNode.textContent.trim()) || doc.title || '';
      if (ui.title.textContent !== title) ui.title.textContent = title;

      var pauseIcon = native('.btnPause .material-icons'), paused = !!pauseIcon && pauseIcon.classList.contains('play_arrow');
      var playIcon = ui.play.firstChild, wanted = 'material-icons ' + (paused ? 'play_arrow' : 'pause');
      if (playIcon.className !== wanted) { playIcon.className = wanted; ui.play.title = paused ? 'Play' : 'Pause'; ui.play.setAttribute('aria-label', ui.play.title); }

      var slider = native('.osdPositionSlider'), canSeek = !!slider && !slider.disabled;
      ui.line.disabled = !canSeek;
      ui.rewind.disabled = !canSeek || !!(native('.btnRewind') || {}).disabled;
      ui.forward.disabled = !canSeek || !!(native('.btnFastForward') || {}).disabled;
      if (!scrubbing && slider && ui.line.value !== slider.value) ui.line.value = slider.value;

      // Live TV with a guide entry: Jellyfin shows the programme's start and end.
      var start = native('.startTimeText'), end = native('.endTimeText');
      var program = visible(start) && visible(end) && !textOf('.osdPositionText').trim() && start.textContent.trim();
      var channel = program || (!canSeek && !times(textOf('.osdPositionText'), textOf('.osdDurationText')));
      ui.box.classList.toggle('zp-is-live', !!channel);
      ui.liveTimes.textContent = program ? start.textContent.trim() + ' – ' + end.textContent.trim() : '';
      if (!scrubbing) {
        var t = times(textOf('.osdPositionText'), textOf('.osdDurationText'));
        ui.elapsed.textContent = t ? formatClock(t.elapsed) : program ? start.textContent.trim() : '--:--';
        ui.remaining.textContent = t ? '−' + formatClock(t.remaining) : program ? end.textContent.trim() : '--:--';
      }
      ui.tracks.classList.toggle('hide', !trackChoices().length);
      ui.fullscreen.classList.toggle('hide', !visible(native('.btnFullscreen')));
    }

    // Jellyfin focuses its own Play button when the controls appear (keyboard,
    // remote). Hand that focus to the matching Zorofin control.
    function redirectFocus(event) {
      if (!ui || ui.box.classList.contains('zp-hidden')) return;
      var target = event.target, map = [['.btnPause', ui.play], ['.btnRewind', ui.rewind], ['.btnFastForward', ui.forward], ['.osdPositionSlider', ui.line]];
      for (var i = 0; i < map.length; i++) {
        if (target.matches && target.matches(map[i][0]) && !map[i][1].disabled) { map[i][1].focus({ preventScroll: true }); return; }
      }
      if (target.closest && target.closest('.videoOsdBottom-maincontrols')) ui.play.focus({ preventScroll: true });
    }

    function attach(found) {
      page = found;
      ensureStyles();
      ui = build();
      page.appendChild(ui.box);
      html.classList.add('zp-on');
      page.addEventListener('focusin', redirectFocus);
      sync();
      timer = root.setInterval(sync, 250);
    }
    function detach() {
      closeMenu(false);
      if (timer) root.clearInterval(timer);
      timer = null;
      if (page) page.removeEventListener('focusin', redirectFocus);
      if (ui) ui.box.remove();
      ui = null; page = null;
      html.classList.remove('zp-on', 'zp-picking', 'zp-controls');
    }
    function check() {
      var found = doc.getElementById('videoOsdPage');
      var active = found && !found.classList.contains('hide') && found.querySelector('.videoOsdBottom-maincontrols');
      if (active && page !== found) { if (page) detach(); attach(found); }
      else if (!active && page) detach();
    }
    // ---- Escape closes Jellyfin's player sheets (quality, settings, tracks) ----
    // Jellyfin itself ignores Escape on these sheets, and an open sheet blocks
    // the controls until something is picked.
    function rememberSheetTrigger(event) {
      if (!event.isTrusted || !event.target.closest) return;
      var b = event.target.closest('#zoroPlayer button, .osdControls .buttons button');
      if (b) sheetTrigger = b;
    }
    function escapeNativeSheet(event) {
      if (event.key !== 'Escape' || menu || optionsScript() || !/^#\/video(?:[/?]|$)/.test(root.location.hash)) return;
      var dialogs = doc.querySelectorAll('.dialog.opened:not(.hide)');
      var sheet = dialogs[dialogs.length - 1], container = sheet && sheet.dialogContainer;
      if (!container || !sheet.classList.contains('actionSheet') || !sheet.backdrop) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (closingSheet === sheet) return;
      closingSheet = sheet;
      var trigger = sheetTrigger;
      sheet.addEventListener('_close', function () {
        closingSheet = null;
        if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
      }, { once: true });
      // Jellyfin closes the sheet when both pointer events hit its backdrop
      // container; that path also clears its focus and history state.
      container.dispatchEvent(new root.MouseEvent('mousedown', { bubbles: true, button: 0 }));
      container.click();
    }

    // ---- Jellyfin Mobile's Native Video Player ----------------------------------
    // iOS draws those controls; the web page only hands over full screen and
    // hides its header and dock while the native player is up.
    function watchExpoVideo() {
      var shell = root.NativeShell;
      if (optionsScript() || !root.ExpoAppSettings || !root.ExpoAppSettings.isNativeVideoPlayerEnabled ||
          !shell || typeof shell.enableFullscreen !== 'function' || typeof shell.disableFullscreen !== 'function') return;
      var player, startupTimer;
      function present(shown) {
        if (html.classList.contains('zp-expo-video') === shown) return;
        html.classList.toggle('zp-expo-video', shown);
        try {
          if (shown) shell.enableFullscreen();
          else if (!/^#\/video(?:[/?]|$)/.test(root.location.hash)) shell.disableFullscreen();
        } catch (_) { /* a failed fullscreen message must not stop playback */ }
      }
      function dismiss() { root.clearTimeout(startupTimer); present(false); }
      function attachPlayer(instance) {
        if (instance === player) return;
        if (player) dismiss();
        player = instance;
        if (!player || typeof player.play !== 'function' || typeof player._reportStatus !== 'function' || typeof player.destroy !== 'function') return;
        ensureStyles();
        var play = player.play, reportStatus = player._reportStatus, destroy = player.destroy;
        player.play = function () {
          present(true);
          root.clearTimeout(startupTimer);
          startupTimer = root.setTimeout(dismiss, 15000);
          try {
            return Promise.resolve(play.apply(this, arguments)).catch(function (error) { dismiss(); throw error; });
          } catch (error) { dismiss(); throw error; }
        };
        player._reportStatus = function (status) {
          if (status && status.uri && status.isPlaying) { root.clearTimeout(startupTimer); present(true); }
          else if (status && status.uri === null && (this.uri || status.didPlayerCloseManually)) dismiss();
          return reportStatus.apply(this, arguments);
        };
        player.destroy = function () { dismiss(); return destroy.apply(this, arguments); };
      }
      if (root.ExpoVideoPlayer) attachPlayer(root.ExpoVideoPlayer);
      else if (!Object.getOwnPropertyDescriptor(root, 'ExpoVideoPlayer')) {
        // Jellyfin Mobile sets this when its web plugin creates the player.
        Object.defineProperty(root, 'ExpoVideoPlayer', { configurable: true, get: function () { return player; }, set: attachPlayer });
      }
    }

    new root.MutationObserver(check).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    doc.addEventListener('click', rememberSheetTrigger, true);
    doc.addEventListener('keydown', escapeNativeSheet, true);
    root.addEventListener('hashchange', function () { sheetTrigger = null; check(); });
    watchExpoVideo();
    check();
  }

  return { mount: mount, parseClock: parseClock, formatClock: formatClock, times: times, skipIcon: skipIcon };
}));
