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
    var unavailable=item.IsMissing===true||item.IsVirtualUnaired===true||item.LocationType==='Virtual';
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
    if(unavailable){var missing=document.createElement('span');missing.className='zoroEpisodeUnavailable';missing.textContent='Unavailable';body.appendChild(missing);}
    card.append(visual, body);
    return card;
  }

  function setNavigatorStatus(navigator, message, stateName) {
    var status = navigator.querySelector('.zoroEpisodeStatus');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('data-state', stateName || '');
  }

  function episodeFeedback(navigator, kind) {
    var old=navigator.querySelector('.zoroEpisodeFeedback');if(old)old.remove();
    if(!kind)return;
    var box=document.createElement('div');box.className='zoroEpisodeFeedback padded-left padded-right';box.setAttribute('role',kind==='error'?'alert':'status');
    var title=document.createElement('h3'),detail=document.createElement('p');
    title.textContent=kind==='loading'?'Loading episodes…':kind==='seasons-loading'?'Loading seasons…':kind==='error'?'Episodes couldn’t load':kind==='no-seasons'?'No seasons available':'This season has no episodes';
    detail.textContent=kind==='loading'||kind==='seasons-loading'?'Your place is saved.':kind==='error'?'Try again, or choose another season.':kind==='no-seasons'?'No seasons are available to your account yet.':'Choose another season, or check again when episodes have been added.';
    box.append(title,detail);
    if(kind==='loading'||kind==='seasons-loading'){
      box.setAttribute('aria-busy','true');var skeleton=document.createElement('div');skeleton.className='zoroEpisodeSkeleton';skeleton.setAttribute('aria-hidden','true');
      for(var i=0;i<3;i++){var row=document.createElement('div');row.className='zoroEpisodeSkeletonRow';row.append(document.createElement('span'),document.createElement('span'));skeleton.appendChild(row);}box.appendChild(skeleton);
    }else{
      var actions=document.createElement('div');actions.className='zoroEpisodeFeedbackActions';
      var retry=document.createElement('button');retry.type='button';retry.className='zoroEpisodeRetry focusable';retry.textContent='Try again';retry.addEventListener('click',function(){(navigator.zoroRetry&&navigator.zoroRetry());});actions.appendChild(retry);
      var select=navigator.querySelector('select');
      if(select&&select.options.length>1){var choose=document.createElement('button');choose.type='button';choose.className='zoroEpisodeChoose focusable';choose.textContent='Choose another season';choose.addEventListener('click',function(){select.focus();try{if(select.showPicker)select.showPicker();}catch(_){}});actions.appendChild(choose);}
      box.appendChild(actions);
    }
    navigator.querySelector('.zoroEpisodeScroller').before(box);
  }

  function renderEpisodeCards(navigator, episodes, currentItemId) {
    var container = navigator.querySelector('.zoroEpisodeItems');
    var scroller = navigator.querySelector('.zoroEpisodeScroller');
    container.textContent = '';
    if (scroller) scroller.scrollLeft = 0;
    episodeFeedback(navigator, null);
    if (episodes === null) { setNavigatorStatus(navigator, '', 'loading'); episodeFeedback(navigator, 'loading'); return; }
    if (!episodes.length) {
      episodeFeedback(navigator, 'empty');
      setNavigatorStatus(navigator, '', 'empty');
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

  function readEpisodeApi(read){var timer;return Promise.race([Promise.resolve().then(read),new Promise(function(_,reject){timer=root.setTimeout(function(){reject(new Error('Episodes timed out'));},10000);})]).finally(function(){root.clearTimeout(timer);});}

  function loadSeasonEpisodes(seriesId, seasonId) {
    if (state.episodeCache[seasonId]) return Promise.resolve(state.episodeCache[seasonId]);
    var client = apiClient(), serial=state.requestSerial;
    return readEpisodeApi(function(){return client.getEpisodes(seriesId, {
      SeasonId: seasonId,
      UserId: client.getCurrentUserId(),
      Fields: ITEM_FIELDS
    });}).then(function (result) {
      if(!result || !Array.isArray(result.Items))throw new Error('Episodes unavailable');
      var episodes = sortEpisodes(result.Items);
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
    select.setAttribute('aria-label', 'Choose season');select.disabled=!seasons.length;
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
      buttons.appendChild(jump);
    }
    if(buttons&&buttons.querySelector('.zoroEpisodeJump'))buttons.querySelector('.zoroEpisodeJump').onclick=function(){section.scrollIntoView({block:'start',behavior:'auto'});select.focus({preventScroll:true});};
    items.addEventListener('keydown',function(event){
      if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
      var cards=Array.prototype.slice.call(items.querySelectorAll('a')),at=cards.indexOf(document.activeElement),next=at+(event.key==='ArrowRight'?1:-1);
      if(at<0 || next<0 || next>=cards.length)return;
      event.preventDefault();event.stopPropagation();cards[next].focus();cards[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
    });
    var selectionRun=0,targetSeason=item.SeasonId,targetEpisode=item.ZoroCurrentEpisodeId||(item.Type==='Episode'?item.Id:null);
    function loadSelected(){
      var selectedSeasonId=select.value,run=++selectionRun,serial=state.requestSerial,client=apiClient(),identity=state.identity;
      section.setAttribute('aria-busy','true');items.replaceChildren();setNavigatorStatus(section,'','');episodeFeedback(section,'loading');
      section.zoroRetry=function(){delete state.episodeCache[select.value];loadSelected();};
      function active(){var current=apiClient();return run===selectionRun&&serial===state.requestSerial&&state.itemId===item.Id&&document.body.contains(section)&&current&&identity===current.serverId()+':'+current.getCurrentUserId()+':'+(current.accessToken?current.accessToken():'');}
      loadSeasonEpisodes(item.SeriesId,selectedSeasonId).then(function(episodes){
        if(!active())return;renderEpisodeCards(section,episodes,targetEpisode||item.Id);
      }).catch(function(){if(active()){setNavigatorStatus(section,'','error');episodeFeedback(section,'error');}}).then(function(){if(active())section.removeAttribute('aria-busy');});
    }
    section.zoroLoadSeason=loadSelected;
    select.addEventListener('change',loadSelected);
    if(seasons.length&&targetSeason&&targetEpisode){
      var jumpCurrent=document.createElement('button');jumpCurrent.type='button';jumpCurrent.className='zoroEpisodeCurrent focusable';jumpCurrent.textContent=item.Type==='Episode'?'Current episode':'Recent episode';
      jumpCurrent.addEventListener('click',function(){select.value=targetSeason;loadSelected();});field.appendChild(jumpCurrent);
    }
    return section;
  }

  function mountEpisodeNavigation(page,item,serial){
    var client=apiClient(),userId=client.getCurrentUserId(),seriesId=item.Type==='Series'?item.Id:item.SeriesId;
    if(typeof client.getSeasons!=='function'||typeof client.getEpisodes!=='function')throw new Error('native episode API unavailable');
    var context=Object.assign({},item,{SeriesId:seriesId}),section=createNavigator(page,context,[],null);
    episodeFeedback(section,'seasons-loading');
    var source=state.identity;
    function active(){var current=apiClient();return serial===state.requestSerial&&state.itemId===item.Id&&isVisible(page)&&current&&source===current.serverId()+':'+current.getCurrentUserId()+':'+(current.accessToken?current.accessToken():'');}
    function load(){
      if(!active())return;episodeFeedback(section,'seasons-loading');
      return readEpisodeApi(function(){return client.getSeasons(seriesId,{userId:userId,Fields:ITEM_FIELDS});}).then(function(result){
        if(!active())return;if(!result||!Array.isArray(result.Items))throw new Error('invalid seasons');
        var seasons=sortSeasons(result.Items);
        if(!seasons.length){episodeFeedback(section,'no-seasons');section.zoroRetry=load;return;}
        var preferred=item.Type==='Season'?item.Id:item.SeasonId;
        var recent=item.Type==='Series'&&typeof client.getItems==='function'?readEpisodeApi(function(){return client.getItems(userId,{ParentId:seriesId,Recursive:true,IncludeItemTypes:'Episode',SortBy:'DatePlayed',SortOrder:'Descending',Limit:1,EnableUserData:true});}).catch(function(){return {Items:[]};}):Promise.resolve({Items:[]});
        return recent.then(function(latest){
          if(!active())return;var episode=latest.Items&&latest.Items[0];
          if(episode&&episode.UserData&&episode.UserData.LastPlayedDate)preferred=episode.SeasonId;
          var season=seasons.filter(function(s){return s.Id===preferred;})[0]||seasons.filter(function(s){return Number(s.IndexNumber)>0;})[0]||seasons[0];
          state.seasons=seasons;context=Object.assign({},item,{SeriesId:seriesId,SeasonId:season.Id,ZoroCurrentEpisodeId:item.Type==='Episode'?item.Id:episode&&episode.UserData&&episode.UserData.LastPlayedDate?episode.Id:null});
          section=createNavigator(page,context,seasons,null);section.zoroLoadSeason();
        });
      }).catch(function(){if(active()){episodeFeedback(section,'error');section.zoroRetry=load;}});
    }
    section.zoroRetry=load;return load();
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
