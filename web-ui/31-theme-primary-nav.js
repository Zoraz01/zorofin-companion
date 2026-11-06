/*
 * Zorofin primary navigation for Jellyfin Home.
 *
 * The Home page's native Home/Favorites switcher becomes a compact primary
 * destination bar on desktop and TV: Home, Shows, Movies, and Live TV. The
 * complete strip is intentionally hidden on phones, where those destinations
 * already live in Home content and the drawer. Routes are copied from
 * Jellyfin's own navigation drawer, so library IDs and permissions remain
 * Jellyfin-owned. The native Favorites button is hidden only while Home is
 * active; its configured Home Screen Sections counterpart is relabeled from
 * "My List" to "Favorites" when that row has content.
 *
 * Library, Live TV, detail, player, dialog, and settings tabs are never
 * modified. If the expected Home or drawer contract is unavailable, this
 * enhancement fails open and leaves the native Home/Favorites switcher intact.
 */
(function (root) {
  'use strict';

  var VERSION = '1.1.0';
  var HOST_CLASS = 'zoroPrimaryNav';
  var LINK_CLASS = 'zoroPrimaryNavLink';
  var FAVORITE_CLASS = 'zoroPrimaryNavNativeFavorite';
  var ACTIVE_PAGE_CLASS = 'zoro-primary-nav-active';
  var MISSING_VALUE = '__zoro_missing__';
  var DESTINATIONS = [
    { key: 'shows', label: 'Shows', pattern: /(?:collectionType=tvshows|#\/tv(?:\?|$))/i },
    { key: 'movies', label: 'Movies', pattern: /(?:collectionType=movies|#\/movies(?:\?|$))/i },
    { key: 'live-tv', label: 'Live TV', pattern: /(?:collectionType=livetv|#\/livetv(?:\?|$))/i },
  ];

  function isHomeRoute(locationLike) {
    if (!locationLike) return false;
    var hash = String(locationLike.hash || '');
    var pathname = String(locationLike.pathname || '');
    return /(?:^|#\/)home(?:\?|$)/i.test(hash) || /(?:^|\/)home(?:\?|$)/i.test(pathname);
  }

  function normalizedText(element) {
    return String(element && element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      VERSION: VERSION,
      DESTINATIONS: DESTINATIONS.map(function (item) {
        return { key: item.key, label: item.label };
      }),
      isHomeRoute: isHomeRoute,
    };
    return;
  }

  if (!root || !root.document || root.zorofinPrimaryNavLoaded) return;
  root.zorofinPrimaryNavLoaded = VERSION;

  var document = root.document;
  var state = {
    host: null,
    page: null,
    favorite: null,
    listHeading: null,
    mountPending: false,
  };

  function isVisible(element) {
    if (!element || !document.body.contains(element)) return false;
    if (element.classList.contains('hide')) return false;
    var style = root.getComputedStyle && root.getComputedStyle(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  }

  function rememberAttribute(element, name) {
    var storage = 'data-zoro-primary-original-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (element.hasAttribute(storage)) return;
    element.setAttribute(storage, element.hasAttribute(name) ? element.getAttribute(name) : MISSING_VALUE);
  }

  function restoreAttribute(element, name) {
    var storage = 'data-zoro-primary-original-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (!element.hasAttribute(storage)) return;
    var original = element.getAttribute(storage);
    if (original === MISSING_VALUE) element.removeAttribute(name);
    else element.setAttribute(name, original);
    element.removeAttribute(storage);
  }

  function visibleHomePage() {
    var pages = document.querySelectorAll('.homePage');
    for (var index = pages.length - 1; index >= 0; index -= 1) {
      if (isVisible(pages[index])) return pages[index];
    }
    return null;
  }

  function visibleHeaderTabs() {
    /* Phone CSS deliberately hides the enhanced host to keep one compact
     * header. Retain that already-validated host instead of interpreting its
     * responsive display:none as a Jellyfin route teardown. */
    if (state.host && document.body.contains(state.host) && state.host.classList.contains(HOST_CLASS)) {
      return state.host;
    }
    var groups = document.querySelectorAll('.skinHeader .headerTabs.sectionTabs');
    for (var index = groups.length - 1; index >= 0; index -= 1) {
      if (isVisible(groups[index])) return groups[index];
    }
    return null;
  }

  function nativeHomeTabs(host) {
    var container = host && host.querySelector('.emby-tabs-slider');
    var buttons = container && container.querySelectorAll(':scope > .emby-tab-button:not(.' + LINK_CLASS + ')');
    var home = null;
    var favorite = null;
    for (var index = 0; buttons && index < buttons.length; index += 1) {
      var text = normalizedText(buttons[index]).toLowerCase();
      if (text === 'home') home = buttons[index];
      if (text === 'favorites' || text === 'favourites') favorite = buttons[index];
    }
    if (!home || !favorite || buttons.length !== 2) return null;
    if (!home.classList.contains('emby-tab-button-active')) return null;
    return { container: container, home: home, favorite: favorite };
  }

  function drawerRoutes() {
    var anchors = document.querySelectorAll('.mainDrawer a.navMenuOption[href], .mainDrawer a.lnkMediaFolder[href]');
    var routes = Object.create(null);
    for (var itemIndex = 0; itemIndex < DESTINATIONS.length; itemIndex += 1) {
      var destination = DESTINATIONS[itemIndex];
      for (var anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
        var href = String(anchors[anchorIndex].getAttribute('href') || '');
        if (destination.pattern.test(href)) {
          routes[destination.key] = href;
          break;
        }
      }
      if (!routes[destination.key]) return null;
    }
    return routes;
  }

  function createLink(destination, href) {
    var link = document.createElement('a');
    link.className = 'emby-tab-button emby-button focusable ' + LINK_CLASS;
    link.href = href;
    link.textContent = destination.label;
    link.setAttribute('data-zoro-primary-route', destination.key);
    link.setAttribute('aria-label', 'Open ' + destination.label);
    return link;
  }

  function renameMyList(page) {
    var heading = page.querySelector('.MyList .sectionTitle');
    if (!heading) return;
    if (!heading.hasAttribute('data-zoro-primary-original-text')) {
      heading.setAttribute('data-zoro-primary-original-text', normalizedText(heading));
    }
    if (heading.textContent !== 'Favorites') heading.textContent = 'Favorites';
    state.listHeading = heading;
  }

  function restore() {
    if (state.host && document.body.contains(state.host)) {
      var links = state.host.querySelectorAll('.' + LINK_CLASS);
      for (var index = 0; index < links.length; index += 1) links[index].remove();
      state.host.classList.remove(HOST_CLASS);
      state.host.removeAttribute('aria-label');
    }
    if (state.favorite && document.body.contains(state.favorite)) {
      state.favorite.classList.remove(FAVORITE_CLASS);
      restoreAttribute(state.favorite, 'hidden');
      restoreAttribute(state.favorite, 'aria-hidden');
      restoreAttribute(state.favorite, 'tabindex');
    }
    if (state.listHeading && document.body.contains(state.listHeading)) {
      var original = state.listHeading.getAttribute('data-zoro-primary-original-text');
      if (original !== null) state.listHeading.textContent = original;
      state.listHeading.removeAttribute('data-zoro-primary-original-text');
    }
    if (state.page && document.body.contains(state.page)) state.page.classList.remove(ACTIVE_PAGE_CLASS);
    state.host = null;
    state.page = null;
    state.favorite = null;
    state.listHeading = null;
  }

  function mount() {
    if (root.ZorofinShell && root.ZorofinShell.active) { if (state.host || state.page) restore(); return; }
    var page = isHomeRoute(root.location) ? visibleHomePage() : null;
    var host = page && visibleHeaderTabs();
    var tabs = host && nativeHomeTabs(host);
    var routes = tabs && drawerRoutes();
    if (!page || !host || !tabs || !routes) {
      if (state.host || state.page) restore();
      return;
    }

    if (state.host === host && state.page === page && host.querySelectorAll('.' + LINK_CLASS).length === 3) {
      renameMyList(page);
      return;
    }
    restore();

    rememberAttribute(tabs.favorite, 'hidden');
    rememberAttribute(tabs.favorite, 'aria-hidden');
    rememberAttribute(tabs.favorite, 'tabindex');
    tabs.favorite.classList.add(FAVORITE_CLASS);
    tabs.favorite.setAttribute('hidden', '');
    tabs.favorite.setAttribute('aria-hidden', 'true');
    tabs.favorite.setAttribute('tabindex', '-1');

    for (var index = 0; index < DESTINATIONS.length; index += 1) {
      var destination = DESTINATIONS[index];
      tabs.container.insertBefore(createLink(destination, routes[destination.key]), tabs.favorite);
    }
    host.classList.add(HOST_CLASS);
    host.setAttribute('aria-label', 'Primary navigation');
    page.classList.add(ACTIVE_PAGE_CLASS);
    state.host = host;
    state.page = page;
    state.favorite = tabs.favorite;
    renameMyList(page);
  }

  function scheduleMount() {
    if (state.mountPending) return;
    state.mountPending = true;
    root.requestAnimationFrame(function () {
      state.mountPending = false;
      mount();
    });
  }

  var observer = new root.MutationObserver(scheduleMount);
  /* Jellyfin can construct Home while it is still hidden, then expose the
   * already-populated page by changing only its class/style state. Observe
   * those visibility signals as well as structural mutations so the fail-open
   * first pass gets one deterministic retry when Home actually becomes active. */
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
    subtree: true,
  });
  root.addEventListener('hashchange', scheduleMount);
  root.addEventListener('pageshow', scheduleMount);
  document.addEventListener('viewshow', scheduleMount);
  document.addEventListener('zoro:shell-change', scheduleMount);
  scheduleMount();
})(typeof window !== 'undefined' ? window : null);
