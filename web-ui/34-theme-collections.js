/* Curated and personal collections, using the signed-in viewer's Jellyfin API. */
(function () {
  'use strict';
  if (window.zorofinCollectionsLoaded) return;
  window.zorofinCollectionsLoaded = true;
  var ID = 'zoroCollections', TTL = 60000, PAGE = 12;
  var identity = '', generation = 0, items = [], shown = PAGE, updated = 0;
  var pending = false, scheduled = false, row = null, signature = '', timer = null;

  function clientIdentity() {
    try {
      var api = window.ApiClient;
      return api && api.accessToken() && api.getCurrentUserId()
        ? String(api.serverId()) + ':' + api.getCurrentUserId() + ':' + api.accessToken() : '';
    } catch (_) { return ''; }
  }
  function homeHost() {
    if (document.hidden || !/(?:^|[\/#])home(?:\.html)?(?:[?&]|$)/i.test(location.hash) ||
        /[?&]tab=(?!0(?:&|$))\d+/i.test(location.hash)) return null;
    var pages = document.querySelectorAll('.homePage, #indexPage, #homePage');
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].classList.contains('hide') || !pages[i].getClientRects().length) continue;
      var tab = pages[i].querySelector('#homeTab');
      if (tab && !tab.classList.contains('hide') && tab.getClientRects().length) return tab.querySelector('.sections');
    }
    return null;
  }
  function count(item) {
    return Math.max(0, Number(item.ChildCount) || 0);
  }
  function detailUrl(id) {
    return '#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(window.ApiClient.serverId());
  }
  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function styles() {
    if (document.getElementById(ID + 'Styles')) return;
    var style = node('style'); style.id = ID + 'Styles';
    style.textContent = [
      // Same shelf as the other Home rows: green title bar, one 16:9 image per
      // card, title and count underneath, and no sub-heading.
      '#zoroCollections{margin:16px 0 24px;contain:layout style;}',
      '#zoroCollections .zc-heading{display:flex;align-items:center;gap:16px;margin:0;padding:0 var(--zoro-home-gutter,3.3%);}',
      '#zoroCollections h2{margin:0;font-size:24px;font-weight:650;line-height:1.25;color:#f5f7f5;}',
      '#zoroCollections h2:before{content:"";display:inline-block;width:3px;height:.82em;margin-right:.48em;border-radius:999px;background:var(--zoro-ui-accent-strong,#25b85f);vertical-align:-.04em;}',
      '#zoroCollections .zc-track{display:flex;gap:var(--zoro-home-gap,20px);overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:20px var(--zoro-home-gutter,3.3%);scroll-padding-inline:var(--zoro-home-gutter,3.3%);}',
      '#zoroCollections .zc-track::-webkit-scrollbar{display:none;}',
      '#zoroCollections .zc-card{display:block;flex:0 0 var(--zoro-home-art,clamp(240px,23vw,400px));min-width:0;color:inherit;text-decoration:none;outline:none;}',
      '#zoroCollections .zc-art{display:flex;position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:12px;background:#242c29;border:1px solid var(--zoro-ui-border,#ffffff2e);box-sizing:border-box;}',
      '#zoroCollections .zc-art:empty:after{content:"COLLECTION";margin:auto;color:#9dbaa8;font-size:.85em;letter-spacing:.13em;}',
      '#zoroCollections .zc-art img{flex:1;width:0;height:100%;object-fit:cover;min-width:0;}',
      '#zoroCollections .zc-art img.zc-cover{position:absolute;inset:0;width:100%;}',
      '#zoroCollections .zc-name{display:block;padding-top:8px;font-size:var(--zoro-home-title,18px);font-weight:600;line-height:1.3;color:#f5f7f5;overflow-wrap:anywhere;}',
      '#zoroCollections .zc-count{display:block;padding-top:4px;color:#bbc5bd;font-size:var(--zoro-home-meta,15px);line-height:1.3;}',
      '#zoroCollections .zc-card:focus-visible .zc-art{outline:3px solid #f5f7f5;outline-offset:4px;}',
      '#zoroCollections .zc-more{flex:0 0 160px;align-self:flex-start;aspect-ratio:16/9;border:1px solid #68786d;border-radius:12px;background:#19211c;color:#f4f8f5;font:inherit;cursor:pointer;padding:16px;}',
      '#zoroCollections .zc-more:focus{outline:3px solid #fff;outline-offset:4px;}',
      '#zoroCollections .zc-status{margin:0 var(--zoro-home-gutter,3.3%);color:#b9c5bd;}',
      '#zoroCollections .zc-status:empty{display:none;}',
      '@media(max-width:599px){#zoroCollections h2{font-size:20px;}#zoroCollections .zc-track{padding-block:14px;}}',
      '.layout-tv #zoroCollections h2{font-size:clamp(26px,1.5625vw,60px);font-weight:700;}.layout-tv #zoroCollections .zc-art{border-radius:var(--zoro-tv-radius,12px);}',
      '@media(prefers-reduced-motion:reduce){#zoroCollections *{scroll-behavior:auto!important;}}'
    ].join('');
    document.head.appendChild(style);
  }
  function clearRow() {
    if (row) row.remove();
    row = null; signature = '';
  }
  function status(message) {
    if (row) row.querySelector('.zc-status').textContent = message;
  }
  function removeUnavailable(id) {
    items = items.filter(function (item) { return item.Id !== id; });
    signature = ''; render();
    status('That collection is no longer available. The list has been updated.');
  }
  function openCollection(event, item) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var epoch = generation, source = identity, hash = location.hash, api = window.ApiClient;
    var user = api.getCurrentUserId();
    Promise.all([api.getItem(user, item.Id), api.getItems(user, {ParentId:item.Id, Limit:1})])
      .then(function (result) {
        if (epoch !== generation || source !== clientIdentity() || location.hash !== hash || !homeHost()) return;
        if (!result[1].Items || !result[1].Items.length) { removeUnavailable(item.Id); return; }
        location.hash = detailUrl(item.Id);
      }).catch(function (error) {
        if (epoch !== generation || source !== clientIdentity() || location.hash !== hash || !homeHost()) return;
        if (error && (error.status === 404 || error.statusCode === 404)) removeUnavailable(item.Id);
        else status('Could not open this collection. Please try again.');
      });
  }
  // Landscape art like the other rows: the collection's own thumb or backdrop.
  // Without one, the card falls back to three member posters.
  function coverFor(item) {
    var tags = item.ImageTags || {};
    if (tags.Thumb) return {type:'Thumb', tag:tags.Thumb};
    if (item.BackdropImageTags && item.BackdropImageTags.length) return {type:'Backdrop', tag:item.BackdropImageTags[0]};
    return null;
  }
  function artwork(cards, epoch, source) {
    // At most three small reads at once; only cards currently rendered need art.
    var queue = cards.slice();
    function next() {
      if (epoch !== generation || source !== clientIdentity() || !homeHost() || !queue.length) return;
      var card = queue.shift(), api = window.ApiClient;
      api.getItems(api.getCurrentUserId(), {ParentId:card.item.Id, Limit:3, SortBy:'PremiereDate,SortName', SortOrder:'Ascending', ImageTypeLimit:1, EnableImageTypes:'Primary,Thumb,Backdrop'})
        .then(function (result) {
          if (epoch !== generation || source !== clientIdentity() || !card.art.isConnected) return;
          var members = result.Items || [];
          // Prefer one member's landscape art, so the card matches the other
          // 16:9 Home rows; three posters side by side are the last resort.
          for (var i = 0; i < members.length; i++) {
            var cover = coverFor(members[i]);
            if (!cover) continue;
            var wide = node('img', 'zc-cover'); wide.alt = ''; wide.loading = 'lazy'; wide.decoding = 'async'; wide.width = 480; wide.height = 270;
            wide.src = api.getImageUrl(members[i].Id, {type:cover.type, tag:cover.tag, maxWidth:640, quality:85});
            wide.addEventListener('error', function () { wide.remove(); }, {once:true});
            card.art.appendChild(wide);
            return;
          }
          members.forEach(function (member) {
            if (!member.ImageTags || !member.ImageTags.Primary) return;
            var image = node('img'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
            image.width = 150; image.height = 225;
            image.src = api.getImageUrl(member.Id, {type:'Primary', tag:member.ImageTags.Primary, maxWidth:200});
            image.addEventListener('error', function () { image.remove(); }, {once:true});
            card.art.appendChild(image);
          });
        }).catch(function () {}).then(next);
    }
    next(); next(); next();
  }
  function render() {
    var host = homeHost();
    if (!host || !identity || identity !== clientIdentity()) { clearRow(); return; }
    if (!items.length) { clearRow(); return; }
    var nextSignature = JSON.stringify(items.map(function (x) { return [x.Id,x.Name,count(x)]; })) + ':' + shown;
    if (row && row.parentNode === host && signature === nextSignature) return;
    var active = document.activeElement;
    var focused = row && row.contains(active);
    var focusId = focused && active.getAttribute('data-collection-id');
    var oldTrack = row && row.querySelector('.zc-track');
    var scrollLeft = oldTrack ? oldTrack.scrollLeft : 0;
    clearRow(); styles();
    row = node('section', 'verticalSection'); row.id = ID; row.setAttribute('aria-labelledby', ID + 'Title');
    var heading = node('div', 'zc-heading'), titles = node('div');
    var title = node('h2', 'sectionTitle', 'Collections'); title.id = ID + 'Title';
    titles.appendChild(title);
    heading.appendChild(titles); row.appendChild(heading);
    var track = node('div', 'zc-track'), cards = [];
    items.slice(0,shown).forEach(function (item) {
      var link = node('a', 'zc-card'); link.href = detailUrl(item.Id);
      link.setAttribute('data-collection-id', item.Id);
      var art = node('div', 'zc-art'); art.setAttribute('aria-hidden', 'true'); link.appendChild(art);
      var cover = coverFor(item);
      if (cover) {
        var image = node('img', 'zc-cover'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.width = 480; image.height = 270;
        image.src = window.ApiClient.getImageUrl(item.Id, {type:cover.type, tag:cover.tag, maxWidth:640, quality:85});
        image.addEventListener('error', function () { image.remove(); if (!art.children.length) artwork([{item:item,art:art}], generation, identity); }, {once:true});
        art.appendChild(image);
      }
      link.appendChild(node('span', 'zc-name', item.Name));
      link.appendChild(node('span', 'zc-count', count(item) + ' in your library'));
      link.addEventListener('click', function (event) { openCollection(event, item); }, true);
      track.appendChild(link); if (!cover) cards.push({item:item,art:art});
    });
    if (shown < items.length) {
      var more = node('button', 'zc-more', 'Show more collections (' + (items.length - shown) + ')'); more.type = 'button';
      more.addEventListener('click', function () {
        var firstNew = shown; shown += PAGE; render();
        var links = row && row.querySelectorAll('.zc-card');
        if (links && links[firstNew]) links[firstNew].focus();
      }); track.appendChild(more);
    }
    track.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      var links = Array.prototype.slice.call(track.querySelectorAll('a,button'));
      var at = links.indexOf(document.activeElement), next = at + (event.key === 'ArrowRight' ? 1 : -1);
      if (at < 0 || next < 0 || next >= links.length) return;
      event.preventDefault(); event.stopPropagation(); links[next].focus();
      links[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
    });
    row.appendChild(track);
    var message = node('p', 'zc-status'); message.setAttribute('role','status'); row.appendChild(message);
    // The shared Home layout places this among discovery rows, after viewing rows.
    host.appendChild(row);
    signature = nextSignature; track.scrollLeft = scrollLeft;
    if (focused) {
      var candidates = row.querySelectorAll('.zc-card'), replacement = candidates[0];
      for (var i = 0; i < candidates.length; i++) if (candidates[i].getAttribute('data-collection-id') === focusId) replacement = candidates[i];
      if (replacement) replacement.focus({preventScroll:true});
    }
    artwork(cards, generation, identity);
  }
  function refresh(force) {
    var current = clientIdentity();
    if (current !== identity) {
      identity = current; generation++; pending = false; items = []; shown = PAGE; updated = 0; clearRow();
    }
    clearTimeout(timer); timer = null;
    if (!identity || !homeHost()) { clearRow(); return; }
    render();
    timer = setTimeout(function () { refresh(false); }, TTL);
    if (pending || (!force && Date.now() - updated < TTL)) return;
    pending = true; updated = Date.now();
    var epoch = generation, source = identity, api = window.ApiClient, all = [];
    function page() {
      return api.getItems(api.getCurrentUserId(), {Recursive:true,IncludeItemTypes:'BoxSet',Fields:'ChildCount,RecursiveItemCount,Tags',EnableImageTypes:'Primary,Thumb,Backdrop',ImageTypeLimit:1,SortBy:'SortName',SortOrder:'Ascending',StartIndex:all.length,Limit:200})
        .then(function (result) {
          if (epoch !== generation || source !== clientIdentity()) return;
          all = all.concat(result.Items || []);
          if (result.Items && result.Items.length && all.length < result.TotalRecordCount) return page();
          items = all.filter(function (item) { return item.Id && count(item) > 0; });
          items.sort(function (a,b) {
            var featuredA = (a.Tags || []).indexOf('Featured') >= 0, featuredB = (b.Tags || []).indexOf('Featured') >= 0;
            return Number(featuredB) - Number(featuredA) || a.Name.localeCompare(b.Name);
          }); render();
        });
    }
    page().catch(function () { if (epoch === generation) status('Collections could not refresh. Try again shortly.'); })
      .then(function () { if (epoch === generation) pending = false; });
  }
  function schedule() {
    if (scheduled) return; scheduled = true;
    setTimeout(function () { scheduled = false; refresh(false); }, 100);
  }
  window.addEventListener('hashchange', function () { updated = 0; schedule(); });
  window.addEventListener('focus', function () { refresh(true); });
  document.addEventListener('visibilitychange', function () { refresh(true); });
  new MutationObserver(schedule).observe(document.body, {childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  schedule();
}());
