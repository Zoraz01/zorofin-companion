/*
 * Zorofin ranked library search for Jellyfin web, mobile, and webOS.
 *
 * The visible draft input stays outside Jellyfin's React state while the user
 * types. After a short pause, its value is handed to Jellyfin's original input
 * exactly once. A small account-scoped metadata index provides fast title,
 * typo, genre, and story matches. Native categories and Seerr remain available.
 *
 * No Jellyfin bundle is patched. If the expected DOM contract disappears, the
 * native input is restored so a Jellyfin update fails open.
 */
(function (root) {
  'use strict';

  var VERSION = '2.2.0';
  var SEARCH_DELAY_MS = 180;
  var MIN_QUERY_LENGTH = 2;
  var STYLE_ID = 'zoroSearchStyles';

  function normaliseQuery(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function isSearchInput(input) {
    if (!input || String(input.tagName || '').toLowerCase() !== 'input') return false;
    if (input.getAttribute('data-zorofin-search') === 'true') return false;
    return input.id === 'searchTextInput' || input.classList.contains('searchfields-txtSearch');
  }

  var CACHE_MS = 5 * 60 * 1000;
  var PAGE_SIZE = 250;
  var MAX_ITEMS = 5000;
  var MAX_RESULTS = 12;
  var TOPICS = {
    space: ['space', 'spaceship', 'spacecraft', 'astronaut', 'interstellar', 'galaxy', 'galactic', 'outer space'],
    superhero: ['superhero', 'superheroes', 'superhuman', 'superpowers', 'batman', 'superman', 'spider man', 'avengers', 'x men'],
    funny: ['comedy', 'comedies', 'comic'],
    scary: ['horror', 'haunted', 'supernatural'],
    scifi: ['science fiction', 'sci fi', 'scifi'],
    heist: ['heist', 'robbery', 'robber', 'thieves'],
    detective: ['detective', 'investigation', 'investigator', 'sleuth'],
    zombie: ['zombie', 'zombies', 'undead'],
    romance: ['romance', 'romantic', 'love story'],
    timetravel: ['time travel', 'time traveler', 'time traveller', 'time machine']
  };

  function fold(value) {
    var text = String(value || '').toLowerCase();
    if (text.normalize) text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return text.replace(/[’']/g, '').replace(/[\u2000-\u206f\u3000-\u303f]/g, ' ').replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function words(value) { return fold(value).split(' ').filter(Boolean); }
  function titleWords(value) { return words(value).filter(function (word) { return !/^(the|a|an)$/.test(word); }); }
  function contains(text, term) { return (' ' + text + ' ').indexOf(' ' + term + ' ') >= 0; }

  // Bounded Damerau-Levenshtein: adjacent transpositions count as one typo.
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    var previous = [], beforePrevious = null;
    for (var j = 0; j <= b.length; j += 1) previous[j] = j;
    for (var i = 1; i <= a.length; i += 1) {
      var row = [i], minimum = i;
      for (j = 1; j <= b.length; j += 1) {
        row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
        }
        minimum = Math.min(minimum, row[j]);
      }
      if (minimum > limit) return limit + 1;
      beforePrevious = previous;
      previous = row;
    }
    return previous[b.length];
  }

  function indexItem(item) {
    var title = fold(item.Name), original = fold(item.OriginalTitle);
    return {
      item: { Id: item.Id, Name: item.Name, Type: item.Type, ProductionYear: item.ProductionYear,
        CommunityRating: item.CommunityRating, UserData: { Played: Boolean(item.UserData && item.UserData.Played) },
        ServerId: item.ServerId, ImageTags: { Primary: item.ImageTags && item.ImageTags.Primary } },
      title: title,
      original: original,
      titleTokens: titleWords(title),
      originalTokens: titleWords(original),
      genres: fold((item.Genres || []).join(' ')),
      tags: fold((item.Tags || []).join(' ')),
      overview: fold(String(item.Overview || '').slice(0, 4000))
    };
  }

  function recommendations(index) {
    // Match native Search: recent library titles, prefer unwatched/artwork/rating,
    // and alternate movies and shows. Keep the selection local to this account.
    var movies = index.filter(function(e){return e.item.Type === 'Movie';}).slice(0,30);
    var shows = index.filter(function(e){return e.item.Type === 'Series';}).slice(0,30);
    function order(a,b) {
      return Number(a.item.UserData.Played)-Number(b.item.UserData.Played) ||
        Number(Boolean(b.item.ImageTags.Primary))-Number(Boolean(a.item.ImageTags.Primary)) ||
        (Number(b.item.CommunityRating)||0)-(Number(a.item.CommunityRating)||0);
    }
    movies.sort(order); shows.sort(order);
    var selected=[];
    for(var i=0;i<Math.max(movies.length,shows.length)&&selected.length<24;i++) {
      if(movies[i])selected.push({item:movies[i].item,reason:''});
      if(shows[i]&&selected.length<24)selected.push({item:shows[i].item,reason:''});
    }
    return selected;
  }

  function titleScore(tokens, candidate) {
    if (!tokens.length || !candidate.length || tokens.length > candidate.length) return 0;
    // One title word cannot satisfy multiple query words.
    var used = {}, quality = 3;
    for (var i = 0; i < tokens.length; i += 1) {
      var word = tokens[i], best = 0, bestIndex = -1;
      for (var j = 0; j < candidate.length; j += 1) {
        if (used[j]) continue;
        var target = candidate[j], match = word === target ? 3 :
          (word.length >= 2 && target.indexOf(word) === 0 ? 2 : 0);
        if (!match && word.length >= 4 && !/^\d+$/.test(word) &&
            distance(word, target, word.length >= 8 ? 2 : 1) <= (word.length >= 8 ? 2 : 1)) match = 1;
        if (match > best) { best = match; bestIndex = j; }
      }
      if (!best) return 0;
      used[bestIndex] = true;
      quality = Math.min(quality, best);
    }
    return (quality === 3 ? 1000 : quality === 2 ? 850 : 700) - (candidate.length - tokens.length) * 3;
  }

  function rank(index, query, limit) {
    var normalized = fold(query);
    if (normalized.length < MIN_QUERY_LENGTH) return [];
    var tokens = titleWords(normalized), year = tokens.filter(function (v) { return /^(19|20)\d{2}$/.test(v); })[0];
    if (year && tokens.length > 1) tokens = tokens.filter(function (v) { return v !== year; });
    else year = null;
    var topicQuery = normalized.replace(/\bsci fi\b/g, 'scifi').replace(/\btime travel\b/g, 'timetravel');
    var topicTokens = words(topicQuery).filter(function (v) {
      return !/^(the|a|an|and|of|about|with|like|movies?|films?|shows?|me|find|something|watch)$/.test(v) && v !== year;
    });
    var matches = [];
    index.forEach(function (entry) {
      if (year && String(entry.item.ProductionYear) !== year) return;
      var score = Math.max(titleScore(tokens, entry.titleTokens), titleScore(tokens, entry.originalTokens));
      if (score < 800 && topicTokens.some(function (term) { return Boolean(TOPICS[term]); })) score = 0;
      var reason = score >= 800 ? 'Title match' : 'Similar title';
      if (entry.title === normalized || entry.original === normalized) score = 1200;
      if (!score && topicTokens.length) {
        var text = [entry.title, entry.original, entry.genres, entry.tags, entry.overview].join(' ');
        var topicScore = 600, expanded = false;
        var complete = topicTokens.every(function (term) {
          if (contains(entry.genres, term)) return true;
          if (contains(entry.tags, term)) { topicScore = Math.min(topicScore, 550); return true; }
          if (contains(text, term)) { topicScore = Math.min(topicScore, 400); return true; }
          var alternatives = TOPICS[term] || (term.endsWith('s') && TOPICS[term.slice(0, -1)]);
          if (alternatives && alternatives.some(function (alternative) { return contains(text, alternative); })) {
            topicScore = Math.min(topicScore, 300); expanded = true; return true;
          }
          return false;
        });
        if (complete) { score = topicScore; reason = expanded ? 'Related topic' : topicScore >= 550 ? 'Genre or topic' : 'Story match'; }
      }
      if (score) matches.push({ item: entry.item, score: score, reason: reason });
    });
    return matches.sort(function (a, b) {
      return b.score - a.score || a.item.Name.localeCompare(b.item.Name) || String(a.item.Id).localeCompare(String(b.item.Id));
    }).slice(0, limit || MAX_RESULTS);
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      VERSION: VERSION,
      SEARCH_DELAY_MS: SEARCH_DELAY_MS,
      MIN_QUERY_LENGTH: MIN_QUERY_LENGTH,
      normaliseQuery: normaliseQuery,
      isSearchInput: isSearchInput,
      fold: fold, indexItem: indexItem, rank: rank, recommendations: recommendations, distance: distance
    };
    return;
  }

  if (!root || !root.document || root.zorofinSearchV2Loaded) return;
  var legacyLoaded = Boolean(root.zorofinSearchLoaded);
  root.zorofinSearchV2Loaded = VERSION;
  root.zorofinSearchLoaded = VERSION;

  var document = root.document;
  var state = {
    page: null,
    nativeInput: null,
    draftInput: null,
    debounceTimer: null,
    composing: false,
    mountCheckPending: false,
    disabled: false,
    nativeAttributes: null,
    lastCommittedQuery: null,
    observedInput: null,
    observedListener: null,
    query: '',
    resultTimer: null,
    section: null,
    resultKey: '',
    renderedQuery: '',
    identity: '',
    catalog: [],
    catalogAt: 0,
    recommendations: [], recommendationsAt: 0, recommendationsLoading: false, recommendationsFailed: false, recommendationRun: 0,
    loading: false,
    generation: 0,
    failedAt: 0
  };

  function isTelevisionLayout() {
    var html = document.documentElement;
    var body = document.body;
    return Boolean(
      html && html.classList.contains('layout-tv') ||
      body && body.classList.contains('layout-tv')
    );
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

  function activeSearchContext() {
    var pages = document.querySelectorAll('#searchPage, .searchPage');
    for (var pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      var page = pages[pageIndex];
      if (!isVisible(page)) continue;
      var field = page.querySelector('.searchFields');
      if (!field) continue;
      var inputs = field.querySelectorAll('#searchTextInput, input.searchfields-txtSearch');
      for (var inputIndex = 0; inputIndex < inputs.length; inputIndex += 1) {
        if (isSearchInput(inputs[inputIndex])) {
          return { page: page, field: field, input: inputs[inputIndex] };
        }
      }
    }
    return null;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID + 'V2')) return;
    var style = document.createElement('style');
    style.id = STYLE_ID + 'V2';
    style.textContent = [
      '.zoroNativeSearchInput{display:none!important;}',
      '.zoroSearchSection{margin:1.2em 0 2em;padding:0 3.3%;contain:layout style;}',
      '.zoroSearchSection[hidden]{display:none!important;}',
      '.zoroSearchStatus{color:#bac4bf;margin:.3em 0 .8em;min-height:1.4em;font-size:.95em;}',
      '.zoroSearchStatus:empty{display:none;}',
      '.zoroSearchSection h2{margin:0 0 .6em;}',
      '.zoroSearchGrid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:20px;}',
      '.zoroSearchCard{display:block;min-width:0;color:inherit;text-decoration:none;border-radius:8px;}',
      '.zoroSearchCard:focus{outline:4px solid #fff;outline-offset:5px;}',
      '@media(hover:hover){.zoroSearchCard:hover{outline:2px solid var(--zoro-accent,#42d779);outline-offset:4px;}}',
      '.zoroSearchPoster{display:block;width:100%;height:auto;aspect-ratio:2/3;object-fit:cover;border-radius:8px;background:#242c29;}',
      '.zoroSearchPoster:not(img){height:0;padding-bottom:150%;}',
      '.zoroSearchTitle{display:block;margin-top:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}',
      '.zoroSearchMeta{display:block;color:#bac4bf;font-size:.85em;line-height:1.5;}',
      '@media(max-width:900px){.zoroSearchGrid{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;}}',
      '@media(max-width:599px){.zoroSearchSection{padding:0 4%;}.zoroSearchGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 10px;}.zoroSearchTitle{font-size:.9em;}}',
      '.layout-tv .zoroSearchGrid{grid-template-columns:repeat(6,minmax(0,1fr));gap:24px;}',
      '.layout-tv .zoroSearchSection{font-size:1.1em;}',
      '.layout-tv .zoroSearchCard:focus{outline-width:5px;outline-offset:6px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function clearDebounce() {
    if (state.debounceTimer !== null) {
      root.clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }

  function dispatchNativeInput(input) {
    var event;
    try {
      event = new root.Event('input', { bubbles: true });
    } catch (_) {
      event = document.createEvent('Event');
      event.initEvent('input', true, false);
    }
    input.dispatchEvent(event);
  }

  function commitToNative(query) {
    var input = state.nativeInput;
    if (!input || !document.body.contains(input)) return false;
    var normalized = normaliseQuery(query);
    if (normalized === state.lastCommittedQuery) return true;
    var descriptor = root.HTMLInputElement &&
      Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, normalized);
    else input.value = normalized;
    state.lastCommittedQuery = normalized;
    dispatchNativeInput(input);
    return true;
  }

  function scheduleCommit() {
    clearDebounce();
    if (!state.draftInput) return;
    var query = normaliseQuery(state.draftInput.value);
    if (!query) {
      commitToNative('');
      return;
    }
    if (query.length < MIN_QUERY_LENGTH) { commitToNative(''); return; }
    state.debounceTimer = root.setTimeout(function () {
      state.debounceTimer = null;
      commitToNative(query);
    }, SEARCH_DELAY_MS);
  }

  function restoreNativeInput() {
    var input = state.nativeInput;
    var attributes = state.nativeAttributes;
    if (!input || !attributes) return;
    input.classList.remove('zoroNativeSearchInput');
    if (attributes.id === null) input.removeAttribute('id');
    else input.id = attributes.id;
    if (attributes.ariaHidden === null) input.removeAttribute('aria-hidden');
    else input.setAttribute('aria-hidden', attributes.ariaHidden);
    if (attributes.tabIndex === null) input.removeAttribute('tabindex');
    else input.setAttribute('tabindex', attributes.tabIndex);
  }

  function unmount() {
    clearDebounce();
    state.composing = false;
    root.clearTimeout(state.resultTimer);
    if (state.observedInput && state.observedListener) {
      state.observedInput.removeEventListener('input', state.observedListener);
      state.observedInput.removeEventListener('compositionend', state.observedListener);
    }
    state.observedInput = null;
    if(state.page){state.page.classList.remove('zoroSearchBrowsing');var clear=state.page.querySelector('.zoroSearchClear');if(clear){clear._input.removeEventListener('input',clear._listener);clear.remove();}}
    if (state.section) state.section.remove();
    state.section = null;
    state.resultKey = '';
    state.query = '';
    var shouldRestoreFocus = state.draftInput && document.activeElement === state.draftInput;
    if (state.draftInput) state.draftInput.remove();
    restoreNativeInput();
    if (shouldRestoreFocus && state.nativeInput && document.body.contains(state.nativeInput)) {
      state.nativeInput.focus();
    }
    state.page = null;
    state.nativeInput = null;
    state.draftInput = null;
    state.nativeAttributes = null;
    state.lastCommittedQuery = null;
  }

  function failOpen(query, reason) {
    state.disabled = true;
    commitToNative(query);
    if (root.console && typeof root.console.warn === 'function') {
      root.console.warn('Zorofin search optimization disabled; native search restored: ' + reason);
    }
    unmount();
  }

  function mount(context) {
    if (state.disabled || isTelevisionLayout() || legacyLoaded) return;
    if (state.nativeInput === context.input && state.draftInput &&
        document.body.contains(state.draftInput)) return;
    if (state.nativeInput) unmount();

    installStyles();
    var nativeInput = context.input;
    var draftInput = nativeInput.cloneNode(false);
    var originalId = nativeInput.getAttribute('id');
    state.page = context.page;
    state.nativeInput = nativeInput;
    state.draftInput = draftInput;
    state.lastCommittedQuery = normaliseQuery(nativeInput.value);
    state.nativeAttributes = {
      id: originalId,
      ariaHidden: nativeInput.getAttribute('aria-hidden'),
      tabIndex: nativeInput.getAttribute('tabindex')
    };

    draftInput.id = originalId || 'searchTextInput';
    draftInput.setAttribute('data-zorofin-search', 'true');
    draftInput.setAttribute('enterkeyhint', 'search');
    draftInput.value = nativeInput.value || '';
    nativeInput.id = (originalId || 'searchTextInput') + 'Native';
    nativeInput.classList.add('zoroNativeSearchInput');
    nativeInput.setAttribute('aria-hidden', 'true');
    nativeInput.setAttribute('tabindex', '-1');
    nativeInput.insertAdjacentElement('afterend', draftInput);

    draftInput.addEventListener('compositionstart', function () {
      state.composing = true;
      clearDebounce();
      root.clearTimeout(state.resultTimer);
    });
    draftInput.addEventListener('compositionend', function () {
      state.composing = false;
      scheduleCommit();
      observeQuery();
    });
    draftInput.addEventListener('input', function () {
      if (!state.composing) scheduleCommit();
    });
    draftInput.addEventListener('keydown', function (event) {
      if (state.composing || event.isComposing) return;
      var query = normaliseQuery(draftInput.value);
      if (event.key === 'Enter' && query.length >= MIN_QUERY_LENGTH) {
        event.preventDefault();
        clearDebounce();
        commitToNative(query);
        observeQuery();
        root.clearTimeout(state.resultTimer);
        renderMatches();
      } else if (event.key === 'Escape' && draftInput.value) {
        event.preventDefault();
        draftInput.value = '';
        clearDebounce();
        commitToNative('');
        observeQuery();
      }
    });
  }

  function account() {
    var client = root.ApiClient;
    try {
      var userId = client && client.getCurrentUserId(), token = client && client.accessToken();
      var hash = root.location && root.location.hash || '';
      var parentMatch = hash.match(/[?&]parentId=([^&]+)/i);
      var typeMatch = hash.match(/[?&]collectionType=([^&]+)/i);
      var parentId = parentMatch ? decodeURIComponent(parentMatch[1]) : '';
      var collectionType = typeMatch ? decodeURIComponent(typeMatch[1]).toLowerCase() : '';
      if (collectionType && !/^(movies|tvshows|boxsets)$/.test(collectionType)) return null;
      if (!userId || !token || typeof client.getItems !== 'function') return null;
      return { client: client, userId: userId, parentId: parentId,
        types: collectionType === 'movies' ? 'Movie' : collectionType === 'tvshows' ? 'Series' : 'Movie,Series',
        key: String(client.serverId()) + ':' + userId + ':' + token + ':' + parentId + ':' + collectionType };
    } catch (_) { return null; }
  }

  function syncAccount() {
    var current = account(), key = current ? current.key : '';
    if (state.identity !== key) {
      state.identity = key;
      state.catalog = [];
      state.recommendations=[];state.recommendationsAt=0;state.recommendationsLoading=false;state.recommendationsFailed=false;state.recommendationRun++;
      state.catalogAt = 0;
      state.loading = false;
      state.failedAt = 0;
      state.generation += 1;
      state.resultKey = '';
      if(state.page)state.page.classList.remove('zoroSearchBrowsing');
      if (state.section) { state.section.remove(); state.section = null; }
    }
    return current;
  }

  function ensureRecommendations() {
    var current=syncAccount();
    if(!current||state.recommendationsLoading||state.recommendationsFailed||Date.now()-state.recommendationsAt<CACHE_MS)return;
    state.recommendationsLoading=true;
    var run=++state.recommendationRun, timer;
    var types=current.types.split(',');
    var requests=types.map(function(type){return Promise.resolve().then(function(){return current.client.getItems(current.userId,{
      Recursive:true,ParentId:current.parentId||undefined,IncludeItemTypes:type,Limit:30,
      EnableUserData:true,EnableImages:true,EnableImageTypes:'Primary',ImageTypeLimit:1,
      SortBy:'DateCreated,SortName',SortOrder:'Descending'
    });});});
    Promise.race([Promise.all(requests),new Promise(function(_,reject){timer=root.setTimeout(function(){reject(Error('Recommendations timeout'));},10000);})])
      .then(function(pages){
        if(run!==state.recommendationRun||!account()||account().key!==current.key)return;
        var seen=new Set(),items=[];
        pages.forEach(function(page){if(!page||!Array.isArray(page.Items))throw Error('Recommendations unavailable');page.Items.forEach(function(item){
          if(item.Id&&item.Name&&/^(Movie|Series)$/.test(item.Type)&&!seen.has(item.Id)){seen.add(item.Id);items.push(indexItem(item));}
        });});
        state.recommendations=recommendations(items);state.recommendationsAt=Date.now();
      }).catch(function(){if(run===state.recommendationRun){state.recommendationsFailed=true;state.recommendations=[];}})
      .finally(function(){root.clearTimeout(timer);if(run===state.recommendationRun){state.recommendationsLoading=false;renderMatches();}});
  }

  function ensureCatalog() {
    var current = syncAccount();
    if (!current || state.loading || Date.now() - state.catalogAt < CACHE_MS ||
        state.failedAt && Date.now() - state.failedAt < 30000) return;
    state.loading = true;
    state.failedAt = 0;
    state.catalog = [];
    var generation = ++state.generation, entries = [], seen = {};
    function load(start) {
      var request = current.client.getItems(current.userId, {
        Recursive: true, ParentId: current.parentId || undefined, IncludeItemTypes: current.types, StartIndex: start, Limit: PAGE_SIZE,
        Fields: 'Genres,Tags,Overview,OriginalTitle', EnableUserData: false,
        EnableImages: true, EnableImageTypes: 'Primary', ImageTypeLimit: 1,
        SortBy: 'SortName', SortOrder: 'Ascending'
      });
      var timer;
      var timeout = new Promise(function (_, reject) {
        timer = root.setTimeout(function () { reject(new Error('Search metadata timeout')); }, 10000);
      });
      return Promise.race([Promise.resolve(request), timeout]).then(function (result) {
        root.clearTimeout(timer);
        if (state.generation !== generation || !account() || account().key !== current.key) return;
        var items = result && result.Items;
        if (!Array.isArray(items)) throw new Error('Search metadata unavailable');
        items.forEach(function (item) {
          if (!item.Id || seen[item.Id] || !/^(Movie|Series)$/.test(item.Type)) return;
          seen[item.Id] = true;
          entries.push(indexItem(item));
        });
        var more = start + items.length < result.TotalRecordCount;
        if (more && (!items.length || start + items.length >= MAX_ITEMS)) throw new Error('Search catalog too large');
        state.catalog = entries.slice();
        if (more) {
          renderMatches();
          return load(start + items.length);
        }
        state.loading = false;
        state.catalogAt = Date.now();
        renderMatches();
      }, function (error) { root.clearTimeout(timer); throw error; });
    }
    Promise.resolve().then(function () { return load(0); }).catch(function () {
      if (state.generation !== generation) return;
      state.loading = false;
      state.failedAt = Date.now();
      state.catalog = [];
      state.catalogAt = 0;
      renderMatches();
    });
  }

  function resultSection() {
    if (state.section && document.body.contains(state.section)) return state.section;
    var field = state.page && state.page.querySelector('.searchFields');
    if (!field) return null;
    state.resultKey = '';
    var section = document.createElement('section');
    section.className = 'zoroSearchSection verticalSection';
    section.setAttribute('aria-label', 'Best library matches');
    var heading = document.createElement('h2');
    heading.className = 'sectionTitle';
    heading.textContent = 'Best matches';
    var status = document.createElement('p');
    status.className = 'zoroSearchStatus';
    status.setAttribute('role', 'status');
    var grid = document.createElement('div');
    grid.className = 'zoroSearchGrid';
    section.appendChild(heading); section.appendChild(status); section.appendChild(grid);
    field.insertAdjacentElement('afterend', section);
    state.section = section;
    return section;
  }

  function resultCard(match, current) {
    var item = match.item, card = document.createElement('a');
    card.className = 'zoroSearchCard focusable';
    card.href = '#/details?id=' + encodeURIComponent(item.Id) + '&serverId=' + encodeURIComponent(item.ServerId || current.client.serverId());
    card.setAttribute('data-id', item.Id);
    card.setAttribute('aria-label', item.Name + (item.ProductionYear ? ', ' + item.ProductionYear : '') + (match.reason ? ', ' + match.reason : ''));
    var poster = document.createElement(item.ImageTags.Primary ? 'img' : 'span');
    poster.className = 'zoroSearchPoster';
    poster.alt = ''; poster.width = 240; poster.height = 360;
    poster.loading = 'lazy'; poster.decoding = 'async';
    if (item.ImageTags.Primary && typeof current.client.getImageUrl === 'function') {
      poster.src = current.client.getImageUrl(item.Id, { type: 'Primary', tag: item.ImageTags.Primary,
        maxWidth: isTelevisionLayout() ? 320 : 240, quality: 80 });
    }
    var title = document.createElement('strong');
    title.className = 'zoroSearchTitle'; title.textContent = item.Name;
    var meta = document.createElement('span'); meta.className = 'zoroSearchMeta';
    meta.textContent = [item.ProductionYear, item.Type === 'Series' ? 'Show' : 'Movie', match.reason].filter(Boolean).join(' · ');
    card.appendChild(poster); card.appendChild(title); card.appendChild(meta);
    return card;
  }

  function renderMatches() {
    var current = syncAccount();
    if (state.composing || !state.page || !isVisible(state.page)) return;
    if (!current || (state.query.length > 0 && state.query.length < MIN_QUERY_LENGTH)) {
      if (state.section) state.section.hidden = true;
      state.resultKey = '';
      return;
    }
    var section = resultSection();
    if (!section) return;
    section.hidden = false;
    var status = section.querySelector('.zoroSearchStatus');
    var browsing = !state.query;
    var matches = browsing ? state.recommendations : rank(state.catalog, state.query);
    var heading=section.querySelector('h2'),title=browsing?'Recommended':'Best matches';
    if(heading.textContent!==title)heading.textContent=title;
    section.setAttribute('aria-label',title);
    state.page.classList.toggle('zoroSearchBrowsing',browsing && matches.length > 0);
    var failed=browsing?state.recommendationsFailed:state.failedAt;
    var message = (browsing?state.recommendationsLoading:state.loading) ? (browsing ? 'Finding recommendations…' : 'Finding matches in your library…') :
      failed ? 'Library matches are unavailable. Try again. Standard search is below.' :
      // Like the apps, a row of results needs no line of explanation under its title.
      matches.length ? '' :
      browsing ? 'Recommended movies and shows will appear as your library grows.' : 'No matching titles. Try another title or spelling.';
    if(status.textContent!==message)status.textContent=message;
    var retry=section.querySelector('.zoroSearchRetry');
    if(failed && !retry){retry=document.createElement('button');retry.type='button';retry.className='zoroSearchRetry focusable';retry.textContent='Try again';retry.addEventListener('click',function(){if(!state.query){state.recommendationsFailed=false;ensureRecommendations();}else{state.failedAt=0;ensureCatalog();}renderMatches();});status.after(retry);}
    if(!failed && retry)retry.remove();
    var key = state.identity + ':' + state.query + ':' + matches.map(function (m) { return m.item.Id + m.reason; }).join(',');
    if (key === state.resultKey) return;
    // Never remove the LG user's focused card when a later metadata page arrives.
    var grid = section.querySelector('.zoroSearchGrid');
    if (grid.contains(document.activeElement) && state.renderedQuery === state.query) return;
    state.resultKey = key;
    state.renderedQuery = state.query;
    var fragment = document.createDocumentFragment();
    matches.forEach(function (match) { fragment.appendChild(resultCard(match, current)); });
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    grid.appendChild(fragment);
  }

  function observeQuery(event) {
    if (state.composing || event && event.isComposing) return;
    var input = state.observedInput;
    if (!input) return;
    var query = normaliseQuery(input.value);
    if (query === state.query) return;
    state.query = query;
    root.clearTimeout(state.resultTimer);
    // Hide old-query cards immediately so a slow response cannot look current.
    if (state.section) state.section.hidden = true;
    if(state.page)state.page.classList.remove('zoroSearchBrowsing');
    if (query.length < MIN_QUERY_LENGTH) { renderMatches(); return; }
    ensureCatalog();
    state.resultTimer = root.setTimeout(renderMatches, SEARCH_DELAY_MS);
  }

  function installClear(input) {
    if(!input)return;
    var existing=input.parentElement.querySelector('.zoroSearchClear');
    if(existing){existing.hidden=!input.value;return;}
    input.placeholder='Search your library';
    var button=document.createElement('button');button.type='button';button.className='zoroSearchClear focusable';
    button.setAttribute('aria-label','Clear search');button.textContent='×';
    button.hidden=!input.value;
    button._input=input;button._listener=function(){button.hidden=!input.value;};input.addEventListener('input',button._listener);
    // TV's alphabet picker uses the same value attribute as the native input.

    button.addEventListener('click',function(){
      var setter=Object.getOwnPropertyDescriptor(root.HTMLInputElement.prototype,'value').set;
      setter.call(input,'');dispatchNativeInput(input);commitToNative('');observeQuery();button.hidden=true;input.focus();
    });
    input.parentElement.appendChild(button);
  }

  function attachResults(context) {
    state.page = context.page;
    var input = state.draftInput || context.field.querySelector('input[data-zorofin-search="true"]') || context.input;
    if (input !== state.observedInput) {
      if (state.observedInput && state.observedListener) {
        state.observedInput.removeEventListener('input', state.observedListener);
        state.observedInput.removeEventListener('compositionend', state.observedListener);
      }
      state.observedInput = input;
      state.observedListener = observeQuery;
      input.addEventListener('input', observeQuery);
      input.addEventListener('compositionend', observeQuery);
    }
    // Defer the metadata index until a meaningful query; opening Search should be immediate.
    if (normaliseQuery(input.value).length >= MIN_QUERY_LENGTH) ensureCatalog();
    if(!normaliseQuery(input.value))ensureRecommendations();
    observeQuery();
    if(!state.query)renderMatches();
    installClear(input);
    if (state.section && !document.body.contains(state.section)) {
      state.section = null;
      state.resultKey = '';
      renderMatches();
    }
  }

  function scheduleMountCheck() {
    if (state.mountCheckPending || state.disabled) return;
    state.mountCheckPending = true;
    root.requestAnimationFrame(function () {
      state.mountCheckPending = false;
      syncAccount();
      if (state.page && (!isVisible(state.page) || state.observedInput && !document.body.contains(state.observedInput))) {
        unmount();
      }
      var context = activeSearchContext();
      if (context) {
        try {
          if (isTelevisionLayout() && state.nativeInput) unmount();
          installStyles();
          mount(context);
          attachResults(context);
        } catch (error) {
          var query = normaliseQuery(state.draftInput && state.draftInput.value || context.input.value);
          if (state.nativeInput) failOpen(query, 'client integration failed');
          else state.disabled = true;
        }
      }
    });
  }

  var observer = new root.MutationObserver(scheduleMountCheck);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
  root.addEventListener('hashchange', scheduleMountCheck);
  root.addEventListener('pageshow', scheduleMountCheck);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleMountCheck(); });
  document.addEventListener('viewshow', scheduleMountCheck);
  scheduleMountCheck();
})(typeof window !== 'undefined' ? window : null);
