/*
 * Zorofin season and episode navigation for Jellyfin detail pages.
 *
 * Jellyfin remains responsible for playback, routing, permissions, and item
 * detail rendering. This module adds only a season selector and episode rail
 * to Series, Season, and Episode detail pages. Selecting an episode opens Jellyfin's native
 * pre-play page; it never starts playback or restyles the surrounding page.
 *
 * The integration is deliberately fail-open. If the route, ApiClient, or DOM
 * contract changes, the custom section is removed and Jellyfin's native
 * season list or "More from season" section becomes visible again.
 */
(function (root) {
  'use strict';

  var VERSION = '2.1.0';
  var NAV_ID = 'zoroEpisodeNavigator';
  var DETAIL_ROUTE = /(?:^|[#!\/])details(?:\?|$)/i;
  var ITEM_FIELDS = 'Overview,PrimaryImageAspectRatio,PremiereDate,RunTimeTicks,UserData';

  function routeItemId(locationLike) {
    if (!locationLike) return '';
    var raw = String(locationLike.hash || '');
    var queryIndex = raw.indexOf('?');
    var query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : String(locationLike.search || '').replace(/^\?/, '');
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

  function episodeNumber(item) {
    var season = Number(item && item.ParentIndexNumber);
    var episode = Number(item && item.IndexNumber);
    if (!Number.isFinite(episode)) return item && item.Name || 'Episode';
    if (!Number.isFinite(season) || season === 0) return 'Special ' + episode;
    return 'S' + (season < 10 ? '0' : '') + season + ' E' + (episode < 10 ? '0' : '') + episode;
  }

  function sortEpisodes(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (left, right) {
      var leftIndex = Number.isFinite(Number(left && left.IndexNumber)) ? Number(left.IndexNumber) : 999999;
      var rightIndex = Number.isFinite(Number(right && right.IndexNumber)) ? Number(right.IndexNumber) : 999999;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left && (left.SortName || left.Name) || '').localeCompare(
        String(right && (right.SortName || right.Name) || '')
      );
    });
  }

  function sortSeasons(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (left, right) {
      var leftIndex = Number.isFinite(Number(left && left.IndexNumber)) ? Number(left.IndexNumber) : 999999;
      var rightIndex = Number.isFinite(Number(right && right.IndexNumber)) ? Number(right.IndexNumber) : 999999;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left && left.Name || '').localeCompare(String(right && right.Name || ''));
    });
  }

  function runtimeText(ticks) {
    var minutes = Math.round(Number(ticks || 0) / 600000000);
    if (!minutes) return '';
    if (minutes < 60) return minutes + ' min';
    var hours = Math.floor(minutes / 60);
    var remainder = minutes % 60;
    return hours + ' hr' + (remainder ? ' ' + remainder + ' min' : '');
  }

  function premiereYear(value) {
    if (!value) return '';
    var year = new Date(value).getFullYear();
    return Number.isFinite(year) ? String(year) : '';
  }

  function playedPercent(item) {
    var value = Number(item && item.UserData && item.UserData.PlayedPercentage);
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      VERSION: VERSION,
      routeItemId: routeItemId,
      isDetailsRoute: isDetailsRoute,
      episodeNumber: episodeNumber,
      sortEpisodes: sortEpisodes,
      sortSeasons: sortSeasons,
      runtimeText: runtimeText,
      playedPercent: playedPercent
    };
    return;
  }

  if (!root || !root.document || root.zorofinEpisodeNavLoaded) return;
  root.zorofinEpisodeNavLoaded = VERSION;

  var document = root.document;
  var state = {
    itemId: '',
    requestSerial: 0,
    mountPending: false,
    page: null,
    item: null,
    seasons: [],
    episodeCache: Object.create(null),
    failedItemId: '', identity: ''
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
    var pages = document.querySelectorAll('#itemDetailPage');
    for (var index = pages.length - 1; index >= 0; index -= 1) {
      if (isVisible(pages[index])) return pages[index];
    }
    return null;
  }

  function clearEnhancement() {
    state.requestSerial += 1;
    var navigator = state.page && state.page.querySelector('#' + NAV_ID);
    if (navigator) navigator.remove();
    if (state.page) {
      state.page.classList.remove('zoro-episode-nav-active','zoro-series-nav-active');
      var jump=state.page.querySelector('.zoroEpisodeJump');if(jump)jump.remove();
    }
    state.page = null;
    state.item = null;
    state.seasons = [];
    state.episodeCache = Object.create(null);
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
      root.console.warn('Zorofin episode navigation disabled for this item; native detail UI restored: ' + reason);
    }
  }

  function itemHref(item) {
    var client = apiClient();
    var serverId = item && item.ServerId || client && typeof client.serverId === 'function' && client.serverId() || '';
    return '#/details?id=' + encodeURIComponent(item && item.Id || '') +
      (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
  }

  function imageUrl(item) {
    var client = apiClient();
    if (!client || !item || !item.Id || typeof client.getImageUrl !== 'function') return '';
    try {
      return client.getImageUrl(item.Id, {
        type: 'Primary',
        tag: item.ImageTags && item.ImageTags.Primary,
        fillWidth: 640,
        fillHeight: 360,
        quality: 88
      });
    } catch (_) {
      return '';
    }
  }

  function episodeCard(item, currentItemId) {
    var card = document.createElement('a');
    var isCurrent = String(item.Id) === String(currentItemId);
    card.className = 'zoroEpisodeCard focusable' + (isCurrent ? ' zoroEpisodeCard-current' : '');
    card.href = itemHref(item);
    card.setAttribute('data-id', item.Id);
    card.setAttribute('data-type', 'Episode');
    card.setAttribute('aria-label', episodeNumber(item) + ', ' + (item.Name || 'Episode') +
      (isCurrent ? ', current episode' : ''));
    if (isCurrent) card.setAttribute('aria-current', 'page');

    var visual = document.createElement('span');
    visual.className = 'zoroEpisodeVisual';
    var image = document.createElement('img');
    image.className = 'zoroEpisodeImage';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = 640;
    image.height = 360;
    var source = imageUrl(item);
    if (source) image.src = source;
    visual.appendChild(image);

    if (isCurrent) {
      var current = document.createElement('span');
      current.className = 'zoroEpisodeBadge zoroEpisodeBadge-current';
      current.textContent = 'Current';
      visual.appendChild(current);
    } else if (item.UserData && item.UserData.Played) {
      var watched = document.createElement('span');
      watched.className = 'zoroEpisodeBadge zoroEpisodeBadge-watched';
      watched.textContent = 'Watched';
      visual.appendChild(watched);
    }

    var percent = playedPercent(item);
    if (percent > 0 && percent < 100) {
      var progress = document.createElement('span');
      progress.className = 'zoroEpisodeProgress';
      progress.setAttribute('aria-label', Math.round(percent) + '% watched');
      var progressValue = document.createElement('span');
      progressValue.style.width = percent + '%';
      progress.appendChild(progressValue);
      visual.appendChild(progress);
    }

    var body = document.createElement('span');
    body.className = 'zoroEpisodeBody';
    var eyebrow = document.createElement('span');
    eyebrow.className = 'zoroEpisodeEyebrow';
    var meta = [episodeNumber(item), runtimeText(item.RunTimeTicks), premiereYear(item.PremiereDate)].filter(Boolean);
    eyebrow.textContent = meta.join('  ·  ');
    var title = document.createElement('strong');
    title.className = 'zoroEpisodeTitle';
    title.textContent = item.Name || 'Episode';
    var overview = document.createElement('span');
    overview.className = 'zoroEpisodeOverview';
    overview.textContent = item.Overview || 'Open the episode for details and playback options.';
    body.append(eyebrow, title, overview);
    card.append(visual, body);
    return card;
  }

  function setNavigatorStatus(navigator, message, stateName) {
    var status = navigator.querySelector('.zoroEpisodeStatus');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('data-state', stateName || '');
  }

  function renderEpisodeCards(navigator, episodes, currentItemId) {
    var container = navigator.querySelector('.zoroEpisodeItems');
    var scroller = navigator.querySelector('.zoroEpisodeScroller');
    container.textContent = '';
    if (scroller) scroller.scrollLeft = 0;
    if (!episodes.length) {
      setNavigatorStatus(navigator, 'No episodes are available in this season.', 'empty');
      return;
    }
    setNavigatorStatus(navigator, episodes.length + (episodes.length === 1 ? ' episode' : ' episodes'));
    episodes.forEach(function (episode) {
      container.appendChild(episodeCard(episode, currentItemId));
    });
    var currentCard = container.querySelector('[aria-current="page"]');
    if (currentCard) {
      root.setTimeout(function () {
        if (document.body.contains(currentCard) && scroller) {
          var target = currentCard.offsetLeft - Math.max(0, (scroller.clientWidth - currentCard.offsetWidth) / 2);
          scroller.scrollLeft = Math.max(0, target);
        }
      }, 80);
    }
  }

  function loadSeasonEpisodes(seriesId, seasonId) {
    if (state.episodeCache[seasonId]) return Promise.resolve(state.episodeCache[seasonId]);
    var client = apiClient(), serial=state.requestSerial;
    return client.getEpisodes(seriesId, {
      SeasonId: seasonId,
      UserId: client.getCurrentUserId(),
      Fields: ITEM_FIELDS
    }).then(function (result) {
      var episodes = sortEpisodes(result && result.Items);
      if(serial===state.requestSerial)state.episodeCache[seasonId] = episodes;
      return episodes;
    });
  }

  function seasonLabel(season) {
    if (!season) return 'Season';
    if (Number(season.IndexNumber) === 0) return 'Specials';
    return season.Name || ('Season ' + season.IndexNumber);
  }

  function createNavigator(page, item, seasons, initialEpisodes) {
    var existing = document.getElementById(NAV_ID);
    if (existing) existing.remove();
    var section = document.createElement('section');
    section.id = NAV_ID;
    section.className = 'zoroEpisodeNavigator verticalSection detailVerticalSection';
    section.setAttribute('aria-labelledby', 'zoroEpisodeNavigatorTitle');

    var header = document.createElement('div');
    header.className = 'zoroEpisodeNavigatorHeader padded-left padded-right';
    var headingGroup = document.createElement('div');
    headingGroup.className = 'zoroEpisodeHeadingGroup';
    var heading = document.createElement('h2');
    heading.id = 'zoroEpisodeNavigatorTitle';
    heading.className = 'sectionTitle sectionTitle-cards';
    heading.textContent = 'Season & episodes';
    var context = document.createElement('p');
    context.className = 'zoroEpisodeContext';
    context.textContent = item.SeriesName || item.Name || 'Choose another episode';
    headingGroup.append(heading, context);

    var field = document.createElement('label');
    field.className = 'zoroSeasonField';
    var fieldLabel = document.createElement('span');
    fieldLabel.className = 'zoroSeasonLabel';
    fieldLabel.textContent = 'Season';
    var select = document.createElement('select');
    select.className = 'emby-select emby-select-withcolor zoroSeasonSelect focusable';
    select.setAttribute('aria-label', 'Choose season');
    seasons.forEach(function (season) {
      var option = document.createElement('option');
      option.value = season.Id;
      option.textContent = seasonLabel(season);
      option.selected = String(season.Id) === String(item.SeasonId);
      select.appendChild(option);
    });
    field.append(fieldLabel, select);
    header.append(headingGroup, field);

    var scroller = document.createElement('div');
    scroller.className = 'zoroEpisodeScroller emby-scroller padded-top-focusscale padded-bottom-focusscale';
    scroller.setAttribute('tabindex', '-1');
    var items = document.createElement('div');
    items.className = 'zoroEpisodeItems focuscontainer-x';
    scroller.appendChild(items);
    var status = document.createElement('p');
    status.className = 'zoroEpisodeStatus padded-left padded-right';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    section.append(header, scroller, status);

    var host = page.querySelector('.detailPageSecondaryContainer .detailPageContent') ||
      page.querySelector('.detailPageSecondaryContainer');
    if (!host) throw new Error('detail section host not found');
    var nativeSection = host.querySelector('.moreFromSeasonSection');
    host.insertBefore(section, nativeSection || host.firstChild);
    renderEpisodeCards(section, initialEpisodes, item.Id);
    page.classList.add('zoro-episode-nav-active');
    if(item.Type==='Series' || item.Type==='Season')page.classList.add('zoro-series-nav-active');
    var buttons=page.querySelector('.mainDetailButtons');
    if(buttons && !buttons.querySelector('.zoroEpisodeJump')){
      var jump=document.createElement('button');jump.type='button';jump.className='zoroEpisodeJump focusable';jump.textContent='Seasons & episodes';
      jump.addEventListener('click',function(){section.scrollIntoView({block:'start',behavior:'auto'});select.focus({preventScroll:true});});buttons.appendChild(jump);
    }
    items.addEventListener('keydown',function(event){
      if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
      var cards=Array.prototype.slice.call(items.querySelectorAll('a')),at=cards.indexOf(document.activeElement),next=at+(event.key==='ArrowRight'?1:-1);
      if(at<0 || next<0 || next>=cards.length)return;
      event.preventDefault();event.stopPropagation();cards[next].focus();cards[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
    });
    var selectedBefore=select.value;


    select.addEventListener('change', function () {
      var selectedSeasonId = select.value;
      var hadFocus=document.activeElement===select;
      select.disabled = true;
      section.setAttribute('aria-busy', 'true');
      setNavigatorStatus(section, 'Loading episodes…', 'loading');
      loadSeasonEpisodes(item.SeriesId, selectedSeasonId).then(function (episodes) {
        if (state.itemId !== item.Id || !document.body.contains(section)) return;
        renderEpisodeCards(section, episodes, item.Id);selectedBefore=selectedSeasonId;
      }).catch(function () {
        if (document.body.contains(section)) {
          select.value=selectedBefore;
          setNavigatorStatus(section, 'This season could not be loaded. Try again.', 'error');
        }
      }).then(function () {
        if (document.body.contains(section)) {
          select.disabled = false;
          section.removeAttribute('aria-busy');
          if(hadFocus && document.activeElement===document.body)select.focus({preventScroll:true});
        }
      });
    });
    return section;
  }

  function mountEpisodeNavigation(page, item, serial) {
    var client=apiClient(), userId=client.getCurrentUserId(), seriesId=item.Type==='Series'?item.Id:item.SeriesId;
    return client.getSeasons(seriesId,{userId:userId,Fields:ITEM_FIELDS}).then(function(result){
      if(serial!==state.requestSerial || state.itemId!==item.Id || !isVisible(page))return;
      var seasons=sortSeasons(result && result.Items);if(!seasons.length)throw new Error('season data unavailable');
      var preferred=item.Type==='Season'?item.Id:item.SeasonId;
      var recent=item.Type==='Series' && typeof client.getItems==='function' ? client.getItems(userId,{ParentId:seriesId,Recursive:true,IncludeItemTypes:'Episode',SortBy:'DatePlayed',SortOrder:'Descending',Limit:1,EnableUserData:true}).catch(function(){return {Items:[]};}) : Promise.resolve({Items:[]});
      return recent.then(function(latest){
        if(serial!==state.requestSerial || state.itemId!==item.Id)return;
        var episode=latest.Items && latest.Items[0];
        if(episode && episode.UserData && episode.UserData.LastPlayedDate)preferred=episode.SeasonId;
        var season=seasons.filter(function(s){return s.Id===preferred;})[0] || seasons.filter(function(s){return Number(s.IndexNumber)>0;})[0] || seasons[0];
        return loadSeasonEpisodes(seriesId,season.Id).then(function(episodes){
          if(serial!==state.requestSerial || state.itemId!==item.Id || !isVisible(page))return;
          state.seasons=seasons;
          var context=Object.assign({},item,{SeriesId:seriesId,SeasonId:season.Id});
          createNavigator(page,context,seasons,episodes);
        });
      });
    });
  }

  function mountCurrentDetail(page, itemId) {
    var client = apiClient();
    if (!client) return;
    resetForRoute(itemId);
    state.page = page;
    var serial = ++state.requestSerial;
    var userId = client.getCurrentUserId();
    client.getItem(userId, itemId).then(function (item) {
      if (serial !== state.requestSerial || state.itemId !== itemId || !isVisible(page)) return;
      state.item = item;
      if (!item || ['Episode','Series','Season'].indexOf(item.Type)<0 || (item.Type!=='Series' && !item.SeriesId)) return;
      return mountEpisodeNavigation(page, item, serial);
    }).catch(function () {
      failOpen(itemId, 'client integration failed');
    });
  }

  function scheduleMountCheck() {
    if (state.mountPending) return;
    state.mountPending = true;
    root.requestAnimationFrame(function () {
      state.mountPending = false;
      var client=apiClient(),identity=client ? client.serverId()+':'+client.getCurrentUserId()+':'+(client.accessToken?client.accessToken():'') : '';
      if(identity!==state.identity){resetForRoute('');state.failedItemId='';state.identity=identity;}
      var page = activeDetailPage();
      var itemId = isDetailsRoute(root.location) ? routeItemId(root.location) : '';
      if (!page || !itemId) {
        if (state.itemId || state.page) resetForRoute('');
        return;
      }
      if (state.itemId === itemId && state.page === page) return;
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
