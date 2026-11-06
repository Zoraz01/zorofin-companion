/* Avatar account menu on wide and TV layouts, matching the Zorofin apps: the
 * signed-in viewer and server, then Switch account, Change server, Quick
 * Connect and Watch together, with Settings pinned at the bottom. Phones keep
 * the Profile tab. Each action reuses Jellyfin web's own route or control. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root);
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  // The actions offered for this viewer, in menu order.
  function actions(options) {
    var list = [
      { key: 'switch', label: 'Switch account' },
      { key: 'server', label: 'Change server' },
      { key: 'quickconnect', label: 'Quick Connect' }
    ];
    if (options && options.syncPlay) list.push({ key: 'together', label: 'Watch together' });
    if (options && options.teams) list.push({ key: 'teams', label: 'Your teams' });
    list.push({ key: 'settings', label: 'Settings', pinned: true });
    return list;
  }

  function mount(root) {
    if (!root || root.zorofinAccountMenuLoaded) return;
    root.zorofinAccountMenuLoaded = true;
    var doc = root.document, html = doc.documentElement, open = null;

    function tv() { return html.classList.contains('layout-tv') || doc.body.classList.contains('layout-tv'); }
    function wide() { return root.innerWidth > 599 || tv(); }
    function node(tag, className, text) {
      var element = doc.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function visible(element) { return !!element && !element.classList.contains('hide') && element.getClientRects().length > 0; }
    function syncButton() { return doc.querySelector('.headerSyncButton'); }
    function styles() {
      if (doc.getElementById('zoroAccountMenuStyles')) return;
      var style = node('style'); style.id = 'zoroAccountMenuStyles';
      style.textContent = [
        '.zam-backdrop{position:fixed;inset:0;z-index:100000;}',
        '.zam-menu{position:fixed;min-width:260px;max-width:min(360px,92vw);padding:8px;border-radius:14px;border:1px solid rgba(255,255,255,.2);background:var(--zoro-graphite,#101411);color:#f4f8f5;box-shadow:0 22px 70px rgba(0,0,0,.6);}',
        '.zam-account{display:flex;align-items:center;gap:12px;padding:10px 12px 12px;border-bottom:1px solid rgba(255,255,255,.14);margin-bottom:6px;}',
        '.zam-avatar{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--zoro-accent-strong,#25b85f);color:#04140a;font-weight:800;}',
        '.zam-name{display:block;font-weight:700;}',
        '.zam-server{display:block;color:#b9c5bd;font-size:.85em;}',
        '.zam-item{display:block;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}',
        '.zam-item:hover,.zam-item:focus{background:#19211c;outline:none;}',
        '.zam-item:focus-visible{outline:3px solid #fff;outline-offset:-3px;}',
        '.zam-pinned{margin-top:6px;border-top:1px solid rgba(255,255,255,.14);padding-top:6px;}',
        '.layout-tv .zam-item{min-height:56px;font-size:1.1em;}'
      ].join('');
      doc.head.appendChild(style);
    }
    function close(restore) {
      if (!open) return;
      var trigger = open.trigger;
      open.backdrop.remove(); doc.removeEventListener('keydown', open.keys, true);
      open = null;
      if (restore !== false && trigger && trigger.isConnected) trigger.focus();
    }
    function run(key) {
      var trigger = open && open.trigger;
      close(key === 'together' || key === 'teams');
      if (key === 'switch') {
        if (root.Dashboard && typeof root.Dashboard.logout === 'function') root.Dashboard.logout();
        else if (root.ApiClient && typeof root.ApiClient.logout === 'function') root.ApiClient.logout().then(function () { root.location.hash = '#/login'; });
      } else if (key === 'server') root.location.hash = '#/selectserver';
      else if (key === 'quickconnect') root.location.hash = '#/quickconnect';
      else if (key === 'together') { var sync = syncButton(); if (sync) sync.click(); }
      else if (key === 'teams') { if (typeof root.zorofinOpenTeams === 'function') root.zorofinOpenTeams(trigger); }
      else if (key === 'settings') root.location.hash = '#/mypreferencesmenu';
    }
    function show(trigger) {
      styles();
      var user = null, server = '';
      try { server = (root.ApiClient.serverInfo && root.ApiClient.serverInfo().Name) || root.ApiClient.serverName && root.ApiClient.serverName() || ''; } catch (_) {}
      var backdrop = node('div', 'zam-backdrop'), menu = node('div', 'zam-menu');
      menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Account');
      var account = node('div', 'zam-account'), avatar = node('span', 'zam-avatar'), text = node('span');
      avatar.setAttribute('aria-hidden', 'true');
      var name = node('span', 'zam-name', 'Signed in'), where = node('span', 'zam-server', server);
      text.appendChild(name); if (server) text.appendChild(where);
      account.appendChild(avatar); account.appendChild(text); menu.appendChild(account);
      actions({ syncPlay: visible(syncButton()), teams: typeof root.zorofinOpenTeams === 'function' }).forEach(function (action) {
        var item = node('button', 'zam-item' + (action.pinned ? ' zam-pinned' : ''), action.label);
        item.type = 'button'; item.setAttribute('role', 'menuitem'); item.dataset.action = action.key;
        item.addEventListener('click', function () { run(action.key); });
        menu.appendChild(item);
      });
      backdrop.appendChild(menu); doc.body.appendChild(backdrop);
      var rect = trigger.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
      var left = Math.min(Math.max(8, rect.right - width), root.innerWidth - width - 8);
      var top = rect.bottom + 8 + height > root.innerHeight ? Math.max(8, rect.top - height - 8) : rect.bottom + 8;
      if (rect.left < 120 && rect.height > rect.width * 2) { left = rect.right + 8; top = Math.min(rect.top, root.innerHeight - height - 8); }
      menu.style.left = left + 'px'; menu.style.top = top + 'px';
      backdrop.addEventListener('click', function (event) { if (event.target === backdrop) close(); });
      function keys(event) {
        var items = Array.prototype.slice.call(menu.querySelectorAll('.zam-item')), at = items.indexOf(doc.activeElement);
        if (event.key === 'Escape' || event.key === 'GoBack' || event.keyCode === 461 || event.key === 'BrowserBack') { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation();
          var next = event.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
          items[next].focus();
        } else if (event.key === 'Tab') { event.preventDefault(); items[(at + (event.shiftKey ? items.length - 1 : 1)) % items.length].focus(); }
      }
      doc.addEventListener('keydown', keys, true);
      open = { backdrop: backdrop, trigger: trigger, keys: keys };
      menu.querySelector('.zam-item').focus();
      Promise.resolve().then(function () { return root.ApiClient.getCurrentUser(); }).then(function (current) {
        user = current;
        if (!open || open.backdrop !== backdrop || !user || !user.Name) return;
        name.textContent = user.Name; avatar.textContent = Array.from(user.Name.trim())[0].toUpperCase();
      }).catch(function () {});
    }
    doc.addEventListener('click', function (event) {
      var link = event.target && event.target.closest && event.target.closest('.zoroNavProfile a');
      if (!link || !wide() || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (open) close(); else show(link);
    }, true);
    root.addEventListener('hashchange', function () { close(false); });
  }

  return { mount: mount, actions: actions };
}));
