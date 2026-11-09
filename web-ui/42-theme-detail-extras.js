/* Zorofin detail and Home extras from the Zorofin plugin, in place of
 * Jellyfin Enhanced's:
 *  - Ratings: IMDb, TMDB, Rotten Tomatoes, Metacritic, Letterboxd and more
 *    (from MDBList, with the operator's key) under a movie or show's details.
 *  - Sonarr / Radarr: for administrators, a link to the title in Sonarr or
 *    Radarr and its tags.
 *  - Remove from Continue Watching: a button on each Continue Watching card
 *    (also the Delete key and the right-click / long-press menu). Progress is
 *    kept; the title comes back when it's played again. Undo is offered. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root && root.document) api.mount();
}(typeof window === 'undefined' ? null : window, function (root) {
  'use strict';
  var SHORT = { imdb: 'IMDb', tmdb: 'TMDB', tomatoes: 'Tomatometer', popcorn: 'Audience', metacritic: 'Metacritic', letterboxd: 'Letterboxd', trakt: 'Trakt', myanimelist: 'MAL' };

  // "8.7", "93%", "73" or "4.1" depending on the source's own scale.
  function display(rating) {
    var v = Number(rating.value);
    if (!isFinite(v) || v <= 0) return '';
    if (rating.source === 'tomatoes' || rating.source === 'popcorn' || rating.source === 'trakt') return Math.round(v) + '%';
    if (rating.source === 'metacritic') return String(Math.round(v));
    if (rating.source === 'letterboxd') return v.toFixed(1) + ' / 5';
    return v.toFixed(1);
  }
  function itemIdFrom(hash) {
    var m = /^#\/details\?(?:.*&)?id=([0-9a-fA-F-]{32,36})(?:&|$)/.exec(String(hash || ''));
    return m ? m[1].replace(/-/g, '').toLowerCase() : '';
  }

  function mount() {
    if (root.ZorofinDetailExtras) return;
    var doc = root.document;
    var state = { id: '', token: 0, toast: null, box: null };
    root.ZorofinDetailExtras = { version: '1.0.0' };

    function make(tag, cls, text) { var el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
    function icon(name) { var i = make('span', 'material-icons', name); i.setAttribute('aria-hidden', 'true'); return i; }
    function extras() { return root.ZorofinExtras ? root.ZorofinExtras.get() : Promise.resolve(null); }
    function page() { return doc.querySelector('.itemDetailPage:not(.hide)'); }
    function anchor(p) { return p && (p.querySelector('.itemMiscInfo-primary:not(.hide)') || p.querySelector('.zoroDetailContextV3') || p.querySelector('.detailPagePrimaryContainer')); }

    // ---- Detail page ----
    function detail() {
      var id = itemIdFrom(root.location.hash);
      if (!id) { state.id = ''; return; }
      var p = page();
      if (!p || !anchor(p)) return;
      // Jellyfin can redraw the page after it loads; put the row back if it went.
      if (state.id === id) { place(); return; }
      state.id = id;
      var token = ++state.token;
      doc.querySelectorAll('.zoroDetailExtras').forEach(function (e) { e.remove(); });
      var box = state.box = make('div', 'zoroDetailExtras');
      extras().then(function (ex) {
        if (!ex || !(ex.ratings || ex.arrLinks)) return;
        if (ex.ratings) {
          root.ZorofinExtras.api('Zorofin/Extras/Ratings/' + id).then(function (r) {
            if (token !== state.token || !r || !r.ratings || !r.ratings.length) return;
            var list = make('ul', 'zde-ratings'); list.setAttribute('aria-label', 'Ratings');
            r.ratings.forEach(function (rating) {
              var text = display(rating); if (!text) return;
              var li = make('li', 'zde-rating'); li.dataset.source = rating.source;
              li.append(make('span', 'zde-source', SHORT[rating.source] || rating.label), make('strong', '', text));
              li.title = rating.label + (rating.votes ? ' · ' + Number(rating.votes).toLocaleString() + ' votes' : '');
              list.appendChild(li);
            });
            if (r.imdbUrl) { var more = make('a', 'zde-link', 'IMDb'); more.href = r.imdbUrl; more.target = '_blank'; more.rel = 'noopener noreferrer'; more.prepend(icon('open_in_new')); list.appendChild(make('li', 'zde-rating zde-out')).appendChild(more); }
            box.prepend(list); place();
          }, function () { /* no ratings is fine */ });
        }
        if (ex.arrLinks) {
          root.ZorofinExtras.api('Zorofin/Arr/Item/' + id).then(function (r) {
            if (token !== state.token || !r || !r.links || !r.links.length) return;
            var row = make('div', 'zde-arr');
            r.links.forEach(function (l) {
              var a = make('a', 'zde-arr-link', 'Open in ' + l.name); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.prepend(icon('open_in_new'));
              row.appendChild(a);
              if (l.monitored === false) row.appendChild(make('span', 'zde-tag', 'Not monitored'));
              (l.tags || []).forEach(function (t) { row.appendChild(make('span', 'zde-tag', t)); });
            });
            box.appendChild(row); place();
          }, function () { /* admin extra only */ });
        }
      });
    }

    function place() {
      var box = state.box, at = anchor(page());
      if (!box || !at || !box.childNodes.length || box.previousElementSibling === at) return;
      at.insertAdjacentElement('afterend', box);
    }

    // ---- Continue Watching ----
    function cwCards() {
      return doc.querySelectorAll('.zoroHomeRow[data-zoro-home-section="continue-watching"] .zoroBrowseCard[data-id]');
    }
    function decorate(ex) {
      if (!ex || ex.schemaVersion < 1) return;
      cwCards().forEach(function (card) {
        if (card.querySelector('.zoroCwRemove')) return;
        var b = make('button', 'zoroCwRemove'); b.type = 'button'; b.tabIndex = -1;
        b.setAttribute('aria-label', 'Remove from Continue Watching'); b.title = 'Remove from Continue Watching';
        b.appendChild(icon('close'));
        b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); remove(card); });
        (card.querySelector('.zoroBrowseArtwork') || card).appendChild(b);
      });
    }
    function remove(card) {
      var id = card.dataset.id, row = card.closest('.zoroHomeRow');
      if (!id || !root.ZorofinExtras) return;
      root.ZorofinExtras.api('Zorofin/Home/ContinueWatching/' + id + '/Hide', { method: 'POST' }).then(function () {
        var next = card.nextElementSibling || card.previousElementSibling, parent = card.parentNode, before = card.nextSibling;
        card.remove();
        if (next && next.focus) next.focus({ preventScroll: true });
        if (row && !row.querySelector('.zoroBrowseCard')) row.hidden = true;
        toast('Removed from Continue Watching', function () {
          root.ZorofinExtras.api('Zorofin/Home/ContinueWatching/' + id + '/Hide', { method: 'DELETE' }).then(function () {
            if (parent && parent.isConnected) { parent.insertBefore(card, before && before.parentNode === parent ? before : null); if (row) row.hidden = false; }
          });
        });
      }, function () { toast('Couldn’t remove it. Try again.'); });
    }
    function toast(text, undo) {
      if (state.toast) state.toast.remove();
      var t = make('div', 'zoroCwToast'); t.setAttribute('role', 'status');
      t.appendChild(make('span', '', text));
      if (undo) { var u = make('button', 'zoroCwUndo', 'Undo'); u.type = 'button'; u.addEventListener('click', function () { t.remove(); undo(); }); t.appendChild(u); }
      doc.body.appendChild(t); state.toast = t;
      root.setTimeout(function () { if (t.isConnected) t.remove(); }, 6000);
    }
    function cardFrom(target) { return target && target.closest && target.closest('.zoroHomeRow[data-zoro-home-section="continue-watching"] .zoroBrowseCard[data-id]'); }
    doc.addEventListener('keydown', function (e) {
      var card = (e.key === 'Delete' || e.key === 'Backspace' && e.shiftKey) && cardFrom(doc.activeElement);
      if (card) { e.preventDefault(); remove(card); }
    });
    doc.addEventListener('contextmenu', function (e) {
      var card = cardFrom(e.target);
      if (!card) return;
      e.preventDefault();
      var menu = make('div', 'zoroCwMenu'); menu.setAttribute('role', 'menu');
      var item = make('button', '', 'Remove from Continue Watching'); item.type = 'button'; item.setAttribute('role', 'menuitem');
      item.prepend(icon('remove_circle_outline'));
      menu.appendChild(item);
      var close = function () { menu.remove(); doc.removeEventListener('pointerdown', outside, true); };
      var outside = function (ev) { if (!menu.contains(ev.target)) close(); };
      item.addEventListener('click', function () { close(); remove(card); });
      menu.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { close(); card.focus(); } });
      menu.style.left = Math.min(e.clientX, root.innerWidth - 300) + 'px'; menu.style.top = Math.min(e.clientY, root.innerHeight - 70) + 'px';
      doc.body.appendChild(menu); item.focus();
      doc.addEventListener('pointerdown', outside, true);
    });

    var queued = false;
    function run() { queued = false; detail(); if (cwCards().length) extras().then(decorate); }
    function schedule() { if (!queued) { queued = true; root.requestAnimationFrame(run); } }
    root.addEventListener('hashchange', function () { state.id = ''; schedule(); });
    doc.addEventListener('viewshow', schedule);
    new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true });
    schedule();
  }

  return { mount: mount, display: display, itemIdFrom: itemIdFrom };
}));
