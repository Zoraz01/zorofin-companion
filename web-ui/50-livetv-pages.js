/*
 * Zorofin Live TV progressive enhancement.
 *
 * This script preserves Jellyfin's native Live TV data, routing, guide,
 * playback handlers, favorites, and Back behavior. It only adds presentation
 * hooks, makes native Play actions explicit, and removes recording UI after
 * the server policy has disabled recording management. If Jellyfin's expected
 * DOM or API contract is missing, the affected enhancement fails open.
 */
(function (root) {
  'use strict';

  var VERSION = '1.1.0';
  var ACTIVE_CLASS = 'zoro-live-tv-active';
  var CHANNEL_DETAIL_CLASS = 'zoro-live-tv-channel-detail';
  var HIDDEN_CLASS = 'zoroLiveTvHiddenControl';
  var PLAY_CLASS = 'zoroLiveTvPlayButton';
  var PLAY_LABEL_CLASS = 'zoroLiveTvPlayLabel';
  var CARD_CLASS = 'zoroLiveTvCardWithPlay';
  var MISSING_VALUE = '__zoro_missing__';

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isLiveTvRoute(locationLike) {
    if (!locationLike) return false;
    return /(?:^|#\/)livetv(?:\?|$)/i.test(String(locationLike.hash || ''));
  }

  function routeItemId(locationLike) {
    if (!locationLike || !/(?:^|#\/)details(?:\?|$)/i.test(String(locationLike.hash || ''))) return '';
    var query = String(locationLike.hash || '').split('?')[1] || '';
    var match = query.match(/(?:^|&)id=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function isRecordingTabLabel(value) {
    var label = normalizedText(value).toLowerCase();
    return label === 'recordings' || label === 'schedule' || label === 'series';
  }

  function isRecordingActionLabel(value) {
    var label = normalizedText(value).toLowerCase();
    return label === 'record' || label === 'record series' || label === 'record program' ||
      label === 'cancel recording' || label === 'cancel series recording' ||
      label === 'stop recording' || label === 'new recording';
  }

  function isHeaderShortcutLabel(value) {
    var label = normalizedText(value).toLowerCase();
    return label === 'syncplay' || label === 'cast to device';
  }

  function isTvChannelItem(item) {
    return String(item && item.Type || '') === 'TvChannel';
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      VERSION: VERSION,
      isLiveTvRoute: isLiveTvRoute,
      routeItemId: routeItemId,
      isRecordingTabLabel: isRecordingTabLabel,
      isRecordingActionLabel: isRecordingActionLabel,
      isHeaderShortcutLabel: isHeaderShortcutLabel,
      isTvChannelItem: isTvChannelItem,
    };
    return;
  }

  if (!root || !root.document || root.zorofinLiveTvLoaded) return;
  root.zorofinLiveTvLoaded = VERSION;

  var document = root.document;
  var state = {
    livePage: null,
    channelPage: null,
    detailItemId: '',
    detailItemType: '',
    detailRequestId: '',
    requestSerial: 0,
    mountPending: false,
  };

  function isVisible(element) {
    if (!element || !document.body.contains(element) || element.classList.contains('hide')) return false;
    var style = root.getComputedStyle && root.getComputedStyle(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function visibleElement(selector) {
    var elements = document.querySelectorAll(selector);
    for (var index = elements.length - 1; index >= 0; index -= 1) {
      if (isVisible(elements[index])) return elements[index];
    }
    return null;
  }

  function storageName(name) {
    return 'data-zoro-live-tv-original-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  function rememberAttribute(element, name) {
    var storage = storageName(name);
    if (element.hasAttribute(storage)) return;
    element.setAttribute(storage, element.hasAttribute(name) ? element.getAttribute(name) : MISSING_VALUE);
  }

  function restoreAttribute(element, name) {
    var storage = storageName(name);
    if (!element || !element.hasAttribute(storage)) return;
    var original = element.getAttribute(storage);
    if (original === MISSING_VALUE) element.removeAttribute(name);
    else element.setAttribute(name, original);
    element.removeAttribute(storage);
  }

  function hideControl(element, reason) {
    if (!element) return;
    rememberAttribute(element, 'hidden');
    rememberAttribute(element, 'aria-hidden');
    rememberAttribute(element, 'tabindex');
    element.classList.add(HIDDEN_CLASS);
    element.setAttribute('data-zoro-live-tv-hidden-reason', reason);
    element.setAttribute('hidden', '');
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('tabindex', '-1');
  }

  function controlLabel(element) {
    return normalizedText(element && (
      element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent
    ));
  }

  function hideHeaderShortcuts() {
    var controls = document.querySelectorAll('.skinHeader .headerRight button, .skinHeader .headerRight [role="button"]');
    for (var index = 0; index < controls.length; index += 1) {
      if (isHeaderShortcutLabel(controlLabel(controls[index]))) hideControl(controls[index], 'unused-header-shortcut');
    }
  }

  function hideRecordingDrawerDestination() {
    var links = document.querySelectorAll('.mainDrawer a.navMenuOption[href], .mainDrawer a.lnkMediaFolder[href]');
    for (var index = 0; index < links.length; index += 1) {
      if (normalizedText(links[index].textContent).toLowerCase() === 'recordings') {
        hideControl(links[index], 'recording-destination');
      }
    }
  }

  function hideRecordingActions() {
    var controls = document.querySelectorAll(
      '#itemDetailPage button, .actionSheet button, .dialog button, [role="menu"] button'
    );
    for (var index = 0; index < controls.length; index += 1) {
      if (isRecordingActionLabel(controlLabel(controls[index]))) hideControl(controls[index], 'recording-action');
    }
  }

  function visibleHeaderTabs() {
    return visibleElement('.skinHeader .headerTabs.sectionTabs');
  }

  function hideRecordingTabs() {
    var host = visibleHeaderTabs();
    var buttons = host && host.querySelectorAll('.emby-tabs-slider > .emby-tab-button');
    if (!buttons || !buttons.length) return;
    var programs = null;
    var activeRecordingTab = null;
    for (var index = 0; index < buttons.length; index += 1) {
      var label = normalizedText(buttons[index].textContent);
      if (label.toLowerCase() === 'programs') programs = buttons[index];
      if (isRecordingTabLabel(label) && buttons[index].classList.contains('emby-tab-button-active')) {
        activeRecordingTab = buttons[index];
      }
    }
    if (activeRecordingTab && programs && typeof programs.click === 'function') programs.click();
    for (var buttonIndex = 0; buttonIndex < buttons.length; buttonIndex += 1) {
      if (isRecordingTabLabel(buttons[buttonIndex].textContent)) {
        hideControl(buttons[buttonIndex], 'recording-tab');
      }
    }
  }

  function isNativePlayButton(button) {
    var label = controlLabel(button).toLowerCase();
    return label === 'play' || label === 'watch live';
  }

  function addPlayLabel(button) {
    if (!button || button.hidden || button.classList.contains('hide') ||
        button.classList.contains(PLAY_CLASS) || !isNativePlayButton(button)) return;
    rememberAttribute(button, 'aria-label');
    rememberAttribute(button, 'title');
    button.classList.add(PLAY_CLASS);
    button.setAttribute('aria-label', 'Watch live');
    button.setAttribute('title', 'Watch live');
    var label = document.createElement('span');
    label.className = PLAY_LABEL_CLASS;
    label.textContent = 'Watch live';
    button.appendChild(label);
    var card = button.closest && button.closest('.card');
    if (card) card.classList.add(CARD_CLASS);
  }

  function decoratePlayButtons(scope) {
    if (!scope) return;
    var buttons = scope.querySelectorAll('button');
    for (var index = 0; index < buttons.length; index += 1) addPlayLabel(buttons[index]);
  }

  function restorePlayButtons(scope) {
    if (!scope) return;
    var buttons = scope.querySelectorAll('.' + PLAY_CLASS);
    for (var index = 0; index < buttons.length; index += 1) {
      var labels = buttons[index].querySelectorAll('.' + PLAY_LABEL_CLASS);
      for (var labelIndex = 0; labelIndex < labels.length; labelIndex += 1) labels[labelIndex].remove();
      buttons[index].classList.remove(PLAY_CLASS);
      restoreAttribute(buttons[index], 'aria-label');
      restoreAttribute(buttons[index], 'title');
      var card = buttons[index].closest && buttons[index].closest('.card');
      if (card && !card.querySelector('.' + PLAY_CLASS)) card.classList.remove(CARD_CLASS);
    }
  }

  function clearChannelPage() {
    if (state.channelPage && document.body.contains(state.channelPage)) {
      restorePlayButtons(state.channelPage.querySelector('.mainDetailButtons'));
      state.channelPage.classList.remove(CHANNEL_DETAIL_CLASS);
    }
    state.channelPage = null;
  }

  function activateChannelPage(page, itemId) {
    if (!page) return;
    state.detailItemId = itemId;
    state.detailItemType = 'TvChannel';
    clearChannelPage();
    document.documentElement.classList.add(ACTIVE_CLASS);
    page.classList.add(CHANNEL_DETAIL_CLASS);
    state.channelPage = page;
    hideRecordingTabs();
    hideRecordingActions();
    decoratePlayButtons(page.querySelector('.mainDetailButtons'));
  }

  function resolveChannelDetail() {
    var itemId = routeItemId(root.location);
    if (!itemId) {
      state.requestSerial += 1;
      state.detailItemId = '';
      state.detailItemType = '';
      state.detailRequestId = '';
      clearChannelPage();
      return;
    }

    if (state.detailItemId === itemId && state.detailItemType) {
      if (state.detailItemType === 'TvChannel') {
        var existingPage = visibleElement('#itemDetailPage');
        if (existingPage) activateChannelPage(existingPage, itemId);
      }
      return;
    }

    if (state.detailRequestId === itemId) return;

    var client = root.ApiClient;
    if (!client || typeof client.getItem !== 'function' || typeof client.getCurrentUserId !== 'function') return;
    state.detailRequestId = itemId;
    var serial = ++state.requestSerial;
    client.getItem(client.getCurrentUserId(), itemId).then(function (item) {
      if (serial !== state.requestSerial || routeItemId(root.location) !== itemId) return;
      state.detailRequestId = '';
      state.detailItemId = itemId;
      state.detailItemType = String(item && item.Type || 'Unknown');
      clearChannelPage();
      if (!isTvChannelItem(item)) return;
      var page = visibleElement('#itemDetailPage');
      if (!page) return;
      activateChannelPage(page, itemId);
    }).catch(function () {
      if (serial !== state.requestSerial) return;
      state.detailRequestId = '';
      state.detailItemId = itemId;
      state.detailItemType = 'Unknown';
      clearChannelPage();
    });
  }

  function mount() {
    hideHeaderShortcuts();
    hideRecordingDrawerDestination();
    hideRecordingActions();

    var livePage = isLiveTvRoute(root.location) ? visibleElement('#liveTvSuggestedPage') : null;
    var detailId = routeItemId(root.location);
    var knownChannelDetail = Boolean(detailId && state.detailItemId === detailId && state.detailItemType === 'TvChannel');
    document.documentElement.classList.toggle(ACTIVE_CLASS, Boolean(livePage) || knownChannelDetail);
    if (state.livePage && state.livePage !== livePage && document.body.contains(state.livePage)) {
      state.livePage.classList.remove(ACTIVE_CLASS);
    }
    state.livePage = livePage;
    if (livePage) {
      livePage.classList.add(ACTIVE_CLASS);
      hideRecordingTabs();
      decoratePlayButtons(livePage);
    }
    resolveChannelDetail();
  }

  function scheduleMount() {
    if (state.mountPending) return;
    state.mountPending = true;
    root.requestAnimationFrame(function () {
      state.mountPending = false;
      observer.disconnect();
      try { mount(); } finally { observer.observe(document.body, observerOptions); }
    });
  }

  var observerOptions = {
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-label', 'title'],
    childList: true,
    subtree: true,
  };
  var observer = new root.MutationObserver(scheduleMount);
  observer.observe(document.body, observerOptions);
  root.addEventListener('hashchange', scheduleMount);
  root.addEventListener('pageshow', scheduleMount);
  document.addEventListener('viewshow', scheduleMount);
  scheduleMount();
})(typeof window !== 'undefined' ? window : null);
