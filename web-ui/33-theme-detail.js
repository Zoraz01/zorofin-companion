/*
 * Zorofin detail experience v3.
 *
 * Jellyfin remains responsible for playback, routes, permissions, dialogs,
 * metadata, focus movement, and Back behavior. V3 only improves the native
 * detail hierarchy and builds a fail-open landscape More Like This rail from
 * Jellyfin's already-rendered related items.
 *
 * The isolated season and episode navigator is intentionally out of scope.
 * This module never queries seasons/episodes and never creates, removes, or
 * styles #zoroEpisodeNavigator.
 */
(function (root) {
  'use strict';

  var VERSION = '3.0.0';
  var ACTIVE_CLASS = 'zoro-detail-v3';
  var CONTEXT_ID = 'zoroDetailContextV3';
  var PROGRESS_ID = 'zoroPlaybackProgressV3';
  var RELATED_ID = 'zoroRelatedRailV3';
  var DETAIL_ROUTE = /(?:^|[#!\/])details(?:\?|$)/i;
  var MISSING_VALUE = '__zoro_missing__';

  function routeItemId(locationLike) {
    if (!locationLike) return '';
    var hash = String(locationLike.hash || '');
    var queryIndex = hash.indexOf('?');
    var query = queryIndex >= 0 ? hash.slice(queryIndex + 1) :
      String(locationLike.search || '').replace(/^\?/, '');
    try {
      return new URLSearchParams(query).get('id') || '';
    } catch (_) {
      var match = query.match(/(?:^|&)id=([^&]+)/i);
      return match ? decodeURIComponent(match[1]) : '';
    }
  }

  function isDetailsRoute(locationLike) {
    if (!locationLike) return false;
    return DETAIL_ROUTE.test(String(locationLike.hash || '')) ||
      /(?:^|\/)details(?:\?|$)/i.test(String(locationLike.pathname || ''));
  }

  function detailTypeClass(item) {
    var type = String(item && item.Type || '').toLowerCase();
    return /^(movie|series|season|episode)$/.test(type) ? 'zoro-detail-' + type : '';
  }

  function seasonName(item) {
    if (item && item.SeasonName) return item.SeasonName;
    var index = Number(item && item.ParentIndexNumber);
    if (!Number.isFinite(index)) return '';
    return index === 0 ? 'Specials' : 'Season ' + index;
  }

  function playedPercent(item) {
    var value = Number(item && item.UserData && item.UserData.PlayedPercentage);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  function playbackProgress(item) {
    var userData = item && item.UserData;
    if (!userData) return null;
    var percent = Math.round(playedPercent(item));
    if (userData.Played || percent >= 100) {
      return { value: 100, label: 'Watched', valueText: '100% complete' };
    }
    if (percent <= 0) return null;
    return { value: percent, label: 'Continue watching', valueText: percent + '% watched' };
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      VERSION: VERSION,
      routeItemId: routeItemId,
      isDetailsRoute: isDetailsRoute,
      detailTypeClass: detailTypeClass,
      seasonName: seasonName,
      playedPercent: playedPercent,
      playbackProgress: playbackProgress
    };
    return;
  }

  if (!root || !root.document || root.zorofinDetailV3Loaded) return;
  root.zorofinDetailV3Loaded = VERSION;

  var document = root.document;
  var state = {
    itemId: '',
    item: null,
    page: null,
    requestSerial: 0,
    mountPending: false,
    failedItemId: ''
  };

  function apiClient() {
    return root.ApiClient && typeof root.ApiClient.getCurrentUserId === 'function'
      ? root.ApiClient
      : null;
  }

  function isVisible(element) {
    if (!element || !document.body.contains(element)) return false;
    if (element.classList.contains('hide')) return false;
    if (root.getComputedStyle) {
      var style = root.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function activeDetailPage() {
    /* Jellyfin can retain the previous detail view as a hidden sibling while
     * mounting the next route, temporarily producing duplicate IDs. Walk from
     * the newest candidate so V3 enhances the visible route, never the stale
     * page left behind by the transition. */
    var pages = document.querySelectorAll('#itemDetailPage');
    for (var index = pages.length - 1; index >= 0; index -= 1) {
      if (isVisible(pages[index])) return pages[index];
    }
    return null;
  }

  function rememberAttribute(element, name) {
    var storage = 'data-zoro-v3-original-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (element.hasAttribute(storage)) return;
    element.setAttribute(storage, element.hasAttribute(name) ? element.getAttribute(name) : MISSING_VALUE);
  }

  function restoreAttribute(element, name) {
    var storage = 'data-zoro-v3-original-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (!element.hasAttribute(storage)) return;
    var original = element.getAttribute(storage);
    if (original === MISSING_VALUE) element.removeAttribute(name);
    else element.setAttribute(name, original);
    element.removeAttribute(storage);
  }

  function cleanupButtons(page) {
    if (!page) return;
    var labels = page.querySelectorAll('.zoroDetailButtonLabelV3');
    for (var labelIndex = 0; labelIndex < labels.length; labelIndex += 1) labels[labelIndex].remove();
    var buttons = page.querySelectorAll('.mainDetailButtons .detailButton');
    for (var index = 0; index < buttons.length; index += 1) {
      buttons[index].classList.remove('zoroDetailIconButtonV3');
      buttons[index].removeAttribute('data-zoro-v3-tooltip');
      restoreAttribute(buttons[index], 'aria-label');
    }
  }

  function cleanupPage(page) {
    if (!page) return;
    var injected = page.querySelectorAll('#' + CONTEXT_ID + ',#' + PROGRESS_ID + ',#' + RELATED_ID);
    for (var index = 0; index < injected.length; index += 1) injected[index].remove();
    cleanupButtons(page);
    page.classList.remove(ACTIVE_CLASS, 'zoro-detail-movie', 'zoro-detail-series',
      'zoro-detail-season', 'zoro-detail-episode', 'zoro-related-v3-ready');
  }

  function clearEnhancement() {
    state.requestSerial += 1;
    cleanupPage(state.page);
    state.item = null;
    state.page = null;
  }

  function resetForRoute(itemId) {
    clearEnhancement();
    state.itemId = itemId || '';
  }

  function failOpen(itemId, reason) {
    if (state.itemId !== itemId) return;
    state.failedItemId = itemId;
    clearEnhancement();
    state.itemId = itemId;
    if (root.console && typeof root.console.warn === 'function') {
      root.console.warn('Zorofin detail v3 disabled; native detail UI restored: ' + reason);
    }
  }

  function buttonHint(button, resumeVisible) {
    var nativeHint = button.getAttribute('title') || button.getAttribute('aria-label') || '';
    if (button.classList.contains('btnPlay')) return nativeHint || 'Resume';
    if (button.classList.contains('btnReplay')) {
      return resumeVisible ? 'Play from beginning' : (nativeHint || 'Play');
    }
    if (button.classList.contains('btnDownload')) return nativeHint || 'Download';
    if (button.classList.contains('btnPlayTrailer')) return nativeHint || 'Play trailer';
    if (button.classList.contains('btnUserRating')) return nativeHint || 'Favorite';
    if (button.classList.contains('btnPlaystate')) return nativeHint || 'Played status';
    if (button.classList.contains('jellyseerr-report-issue-icon')) return nativeHint || 'Report issue';
    if (button.classList.contains('btnMoreCommands')) return nativeHint || 'More actions';
    return nativeHint;
  }

  function enhanceButtons(page) {
    var buttons = page.querySelectorAll('.mainDetailButtons .detailButton');
    var resumeButton = page.querySelector('.mainDetailButtons .btnPlay:not(.hide)');
    var resumeVisible = Boolean(resumeButton && isVisible(resumeButton));
    for (var index = 0; index < buttons.length; index += 1) {
      var button = buttons[index];
      var content = button.querySelector('.detailButton-content');
      if (!content) continue;
      var hint = buttonHint(button, resumeVisible);
      if (hint) {
        rememberAttribute(button, 'aria-label');
        button.setAttribute('aria-label', hint);
        button.setAttribute('data-zoro-v3-tooltip', hint);
      }
      var visibleLabel = button.classList.contains('btnPlay') || button.classList.contains('btnReplay');
      button.classList.toggle('zoroDetailIconButtonV3', !visibleLabel && Boolean(hint));
      if (!visibleLabel) continue;
      var label = content.querySelector('.zoroDetailButtonLabelV3');
      if (!label) {
        label = document.createElement('span');
        label.className = 'zoroDetailButtonLabelV3';
        content.appendChild(label);
      }
      label.textContent = hint;
    }
  }

  function itemHref(item) {
    var client = apiClient();
    var serverId = item && item.ServerId ||
      client && typeof client.serverId === 'function' && client.serverId() || '';
    return '#/details?id=' + encodeURIComponent(item && item.Id || '') +
      (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
  }

  function createContext(page, item) {
    var existing = page.querySelector('#' + CONTEXT_ID);
    if (existing) return existing;
    var nameContainer = page.querySelector('.infoWrapper .nameContainer') || page.querySelector('.nameContainer');
    if (!nameContainer || !nameContainer.parentNode) return null;
    var context = document.createElement(item.Type === 'Episode' ? 'nav' : 'div');
    context.id = CONTEXT_ID;
    context.className = 'zoroDetailContextV3';

    if (item.Type === 'Episode' && item.SeriesId && item.SeriesName) {
      context.setAttribute('aria-label', 'Series and season');
      var series = document.createElement('a');
      series.className = 'zoroDetailContextLinkV3 focusable';
      series.href = itemHref({ Id: item.SeriesId, ServerId: item.ServerId });
      series.textContent = item.SeriesName;
      series.setAttribute('aria-label', 'Open series ' + item.SeriesName);
      context.appendChild(series);
      var currentSeason = seasonName(item);
      if (currentSeason) {
        var separator = document.createElement('span');
        separator.className = 'zoroDetailContextSeparatorV3';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '›';
        var season = document.createElement('span');
        season.textContent = currentSeason;
        context.append(separator, season);
      }
    } else {
      context.textContent = item.Type === 'Movie' ? 'Movie' :
        item.Type === 'Series' ? 'Series' : item.Type === 'Season' ? 'Season' : 'Details';
    }

    nameContainer.parentNode.insertBefore(context, nameContainer);
    return context;
  }

  function createPlaybackProgress(page, item) {
    var existing = page.querySelector('#' + PROGRESS_ID);
    if (existing) return existing;
    if (!item || (item.Type !== 'Movie' && item.Type !== 'Episode')) return null;
    var progress = playbackProgress(item);
    if (!progress) return null;
    var buttons = page.querySelector('.mainDetailButtons');
    if (!buttons || !buttons.parentNode) return null;

    var container = document.createElement('div');
    container.id = PROGRESS_ID;
    container.className = 'zoroPlaybackProgressV3' +
      (progress.value === 100 ? ' zoroPlaybackProgressV3-complete' : '');
    var copy = document.createElement('div');
    copy.className = 'zoroPlaybackProgressCopyV3';
    var label = document.createElement('strong');
    label.textContent = progress.label;
    var value = document.createElement('span');
    value.textContent = progress.valueText;
    copy.append(label, value);

    var track = document.createElement('div');
    track.className = 'zoroPlaybackProgressTrackV3';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Playback progress');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(progress.value));
    track.setAttribute('aria-valuetext', progress.valueText);
    var fill = document.createElement('span');
    fill.className = 'zoroPlaybackProgressFillV3';
    fill.style.width = progress.value + '%';
    track.appendChild(fill);
    container.append(copy, track);
    buttons.parentNode.insertBefore(container, buttons);
    return container;
  }

  function imageUrl(item) {
    var client = apiClient();
    if (!client || !item || !item.Id || typeof client.getImageUrl !== 'function') return '';
    try {
      return client.getImageUrl(item.Id, {
        type: 'Backdrop',
        index: 0,
        fillWidth: 960,
        fillHeight: 540,
        quality: 88
      });
    } catch (_) {
      return '';
    }
  }

  function nativeRelatedItems(page) {
    var cards = page.querySelectorAll('#similarCollapsible .card[data-id]');
    var result = [];
    for (var index = 0; index < cards.length && result.length < 12; index += 1) {
      var card = cards[index];
      var id = card.getAttribute('data-id');
      if (!id) continue;
      var texts = card.querySelectorAll('.cardText');
      var link = card.querySelector('a[href]');
      result.push({
        Id: id,
        ServerId: card.getAttribute('data-serverid') || '',
        Name: texts[0] && texts[0].textContent.trim() || card.getAttribute('aria-label') || 'Title',
        Secondary: texts[1] && texts[1].textContent.trim() || '',
        Href: link && link.getAttribute('href') || ''
      });
    }
    return result;
  }

  function relatedCard(item, fallbackType) {
    var card = document.createElement('a');
    card.className = 'zoroRelatedCardV3 focusable';
    card.href = item.Href || itemHref(item);
    card.setAttribute('data-id', item.Id);
    card.setAttribute('aria-label', 'Open ' + item.Name);

    var visual = document.createElement('span');
    visual.className = 'zoroRelatedVisualV3';
    var image = document.createElement('img');
    image.className = 'zoroRelatedImageV3';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 960;
    image.height = 540;
    image.addEventListener('error', function () { this.setAttribute('data-state', 'error'); });
    var source = imageUrl(item);
    if (source) image.src = source;
    else image.setAttribute('data-state', 'error');
    visual.appendChild(image);

    var body = document.createElement('span');
    body.className = 'zoroRelatedBodyV3';
    var eyebrow = document.createElement('span');
    eyebrow.className = 'zoroRelatedEyebrowV3';
    eyebrow.textContent = item.Secondary || fallbackType;
    var title = document.createElement('strong');
    title.className = 'zoroRelatedTitleV3';
    title.textContent = item.Name;
    body.append(eyebrow, title);
    card.append(visual, body);
    return card;
  }

  function syncRelatedRail(page, item) {
    if (page.querySelector('#' + RELATED_ID)) return;
    var nativeSection = page.querySelector('#similarCollapsible');
    if (!nativeSection || nativeSection.classList.contains('hide')) return;
    var related = nativeRelatedItems(page);
    if (related.length < 4) return;

    var section = document.createElement('section');
    section.id = RELATED_ID;
    section.className = 'zoroRelatedRailV3 verticalSection detailVerticalSection';
    section.setAttribute('aria-labelledby', RELATED_ID + 'Title');
    var header = document.createElement('div');
    header.className = 'zoroRelatedHeaderV3 padded-right';
    var group = document.createElement('div');
    var heading = document.createElement('h2');
    heading.id = RELATED_ID + 'Title';
    heading.className = 'zoroRelatedHeadingV3 sectionTitle sectionTitle-cards';
    heading.textContent = 'More Like This';
    var context = document.createElement('p');
    context.className = 'zoroRelatedContextV3';
    context.textContent = item.Type === 'Series' ? 'Explore related series' : 'Explore related movies';
    group.append(heading, context);
    var count = document.createElement('span');
    count.className = 'zoroRelatedCountV3';
    count.textContent = related.length + ' titles';
    header.append(group, count);

    var scroller = document.createElement('div');
    scroller.className = 'zoroRelatedScrollerV3 emby-scroller padded-top-focusscale padded-bottom-focusscale';
    scroller.setAttribute('tabindex', '-1');
    var items = document.createElement('div');
    items.className = 'zoroRelatedItemsV3 focuscontainer-x';
    for (var index = 0; index < related.length; index += 1) {
      items.appendChild(relatedCard(related[index], item.Type === 'Series' ? 'Series' : 'Movie'));
    }
    scroller.appendChild(items);
    section.append(header, scroller);
    nativeSection.parentNode.insertBefore(section, nativeSection);
    page.classList.add('zoro-related-v3-ready');
  }

  function syncActiveExperience() {
    var page = state.page;
    var item = state.item;
    if (!page || !item || !isVisible(page)) return;
    enhanceButtons(page);
    createContext(page, item);
    createPlaybackProgress(page, item);
    if (item.Type === 'Movie' || item.Type === 'Series') syncRelatedRail(page, item);
  }

  function activate(page, item) {
    state.page = page;
    state.item = item;
    page.classList.add(ACTIVE_CLASS);
    var typeClass = detailTypeClass(item);
    if (typeClass) page.classList.add(typeClass);
    syncActiveExperience();
  }

  function mountCurrentDetail(page, itemId) {
    var client = apiClient();
    if (!client || typeof client.getItem !== 'function') return;
    resetForRoute(itemId);
    state.page = page;
    var serial = ++state.requestSerial;
    client.getItem(client.getCurrentUserId(), itemId).then(function (item) {
      if (serial !== state.requestSerial || state.itemId !== itemId || !isVisible(page)) return;
      if (!detailTypeClass(item)) return;
      activate(page, item);
    }).catch(function () {
      failOpen(itemId, 'signed-in item lookup failed');
    });
  }

  function scheduleMountCheck() {
    if (state.mountPending) return;
    state.mountPending = true;
    root.requestAnimationFrame(function () {
      state.mountPending = false;
      var page = activeDetailPage();
      var itemId = isDetailsRoute(root.location) ? routeItemId(root.location) : '';
      if (!page || !itemId) {
        if (state.itemId || state.page) resetForRoute('');
        return;
      }
      if (state.itemId === itemId && state.page === page) {
        syncActiveExperience();
        return;
      }
      if (state.failedItemId === itemId) return;
      if (state.failedItemId && state.failedItemId !== itemId) state.failedItemId = '';
      mountCurrentDetail(page, itemId);
    });
  }

  var observer = new root.MutationObserver(scheduleMountCheck);
  observer.observe(document.body, { childList: true, subtree: true });
  root.addEventListener('hashchange', scheduleMountCheck);
  root.addEventListener('pageshow', scheduleMountCheck);
  document.addEventListener('viewshow', scheduleMountCheck);
  scheduleMountCheck();
})(typeof window !== 'undefined' ? window : null);
