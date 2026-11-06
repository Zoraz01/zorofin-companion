/* Stable Home order, one recent Continue Watching entry per series, and native
 * playback from the featured banner. */
(function(root,factory){
  'use strict';var api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;else api.mount(root);
}(typeof window==='undefined'?null:window,function(){
  'use strict';
  function continuationRank(item){
    var data=item.UserData||{},position=Number(data.PlaybackPositionTicks),duration=Number(item.RunTimeTicks);
    // A rewatch can retain Played=true while it has a genuine resume position.
    // Fully completed entries must not suppress the server's unstarted Next Up.
    if(Number(data.PlayedPercentage)>=100 || (duration>0 && position>=duration))return 0;
    if(Number.isFinite(position) && position>0)return 2;
    return data.Played===true ? 0 : 1;
  }
  function latestPerSeries(items){
    var winners=Object.create(null), order=[];
    (items||[]).forEach(function(item){
      var key=item.Type==='Episode' && item.SeriesId ? 'series:'+item.SeriesId : 'item:'+item.Id;
      var old=winners[key];if(!old)order.push(key);
      var date=Date.parse(item.UserData && item.UserData.LastPlayedDate)||0;
      var oldDate=old && Date.parse(old.UserData && old.UserData.LastPlayedDate)||0;
      var rank=continuationRank(item),oldRank=old && continuationRank(old);
      if(!old || rank>oldRank || (rank===oldRank && date>oldDate))winners[key]=item;
    });
    return order.map(function(key){return winners[key];});
  }
  function playbackManager(root){
    var chunks=root.webpackChunk,manager;
    if(!chunks || chunks.push===Array.prototype.push)return;
    // Jellyfin's native card player is a webpack export. Match its methods
    // because the module ID and export name can change between builds.
    chunks.push([[Symbol('zorofin-banner-play')],{},function(require){
      var id=Object.keys(require.m||{}).find(function(key){
        var source=Function.prototype.toString.call(require.m[key]);
        return /\.translateItemsForPlayback\s*=/.test(source) && /\.getItemsForPlayback\s*=/.test(source);
      });
      if(!id)return;
      manager=Object.values(require(id)).find(function(value){
        return value && typeof value.play==='function' && typeof value.getCurrentPlayer==='function';
      });
    }]);
    return manager;
  }
  function mount(root){
    if(!root || root.zorofinHomeLayoutLoaded)return;root.zorofinHomeLayoutLoaded=true;
    var doc=root.document,identity='',epoch=0,cache=Object.create(null),cardNodes=Object.create(null),pending=false,scheduled=false,timer=null;
    var knownRows=new WeakMap(),guardedScroll=null,player=null,bannerPlayPending=false;
    function who(){try{var a=root.ApiClient;return a && a.getCurrentUserId() && a.accessToken() ? a.serverId()+':'+a.getCurrentUserId()+':'+a.accessToken() : '';}catch(_){return '';}}
    function onHome(){
      var hash=root.location.hash;
      return /(?:^|[\/#])home(?:\.html)?(?:[?&]|$)/i.test(hash) &&
        !/[?&](?:tab=(?!0(?:&|$))\d+|zorofin=requests)(?:&|$)/i.test(hash);
    }
    function host(){
      if(doc.hidden || !onHome())return null;
      var tabs=doc.querySelectorAll('.homePage #homeTab, #indexPage #homeTab');
      for(var i=tabs.length-1;i>=0;i--)if(!tabs[i].classList.contains('hide') && tabs[i].getClientRects().length)return tabs[i].querySelector('.sections');
      return null;
    }
    function playBanner(event){
      var button=event.target.closest && event.target.closest('#slides-container .slide.active[data-item-id] .play-button');
      if(!button || !onHome())return;
      var itemId=button.closest('.slide').dataset.itemId,client=root.ApiClient,account=who();
      if(!itemId || !account)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if(bannerPlayPending)return;
      function openDetails(){
        if(onHome() && who()===account)root.location.hash='#/details?id='+encodeURIComponent(itemId)+'&serverId='+encodeURIComponent(client.serverId());
      }
      try{
        if(!player)player=playbackManager(root);
        if(!player){openDetails();return;}
        bannerPlayPending=true;
        // Use the same player as Jellyfin's library cards. Media Bar's own
        // handler sends a remote command, which can disappear with the socket.
        Promise.resolve(player.play({ids:[itemId],serverId:client.serverId()}))
          .catch(openDetails).finally(function(){bannerPlayPending=false;});
      }catch(_){
        bannerPlayPending=false;
        openDetails();
      }
    }
    function guardHomePagination(){
      var meta=root.HssPageMeta,handler=meta && meta.ScrollHandler;
      if(typeof handler!=='function' || handler===guardedScroll)return;
      if(guardedScroll)root.removeEventListener('scroll',guardedScroll);
      root.removeEventListener('scroll',handler);
      // Home Screen Sections registers on window, so its handler can outlive
      // the Home spinner. Keep the plugin's listener attached to its own page.
      guardedScroll=function(event){
        var container=host();
        if(root.HssPageMeta===meta && container && container.querySelector('#hssLoadingIndicator'))handler.call(this,event);
      };
      meta.ScrollHandler=guardedScroll;
      root.addEventListener('scroll',guardedScroll);
    }
    function restoreCards(){doc.querySelectorAll('[data-zoro-duplicate]').forEach(function(card){card.removeAttribute('data-zoro-duplicate');});}
    // Home order, like the iOS and Apple TV apps: Continue Watching, live events,
    // My Requests, then Zorofin's own rows mixed in at random among the server's
    // rows. Each row keeps its random slot for this visit, so refreshes and
    // continued loading never reshuffle what the viewer is looking at.
    var MIX_SPREAD=8,mixSlots=Object.create(null);
    function isContinue(row){return row.matches('.ContinueWatchingNextUp,.ContinueWatching,.resumeSection');}
    function isRequests(row){return row.matches('.MyJellyseerrRequests')||row.id==='zoroHomeRow-requests-ready';}
    function isMixed(row){return row.id==='zoroCollections'||(/^zoroHomeRow-/.test(row.id)&&row.id!=='zoroHomeRow-requests-ready');}
    function ours(row){return row.id==='zoroLiveEvents'||row.id==='zoroCollections'||/^zoroHomeRow-/.test(row.id);}
    function slotFor(row){if(!(row.id in mixSlots))mixSlots[row.id]=Math.floor(Math.random()*(MIX_SPREAD+1));return mixSlots[row.id];}
    function arrange(container){
      var rows=Array.prototype.slice.call(container.children).filter(function(row){return row.classList.contains('verticalSection') && row.id!=='hssLoadingIndicator';});
      rows.forEach(function(row){
        if(!knownRows.has(row)){knownRows.set(row,{order:Number(row.style.order)||0,index:knownRows.sequence||0});knownRows.sequence=(knownRows.sequence||0)+1;}
      });
      function configured(a,b){return knownRows.get(a).order-knownRows.get(b).order || knownRows.get(a).index-knownRows.get(b).index;}
      var live=rows.filter(function(r){return r.id==='zoroLiveEvents';});
      var pinned=rows.filter(isContinue).sort(configured).concat(live,rows.filter(isRequests).sort(configured));
      var mixed=rows.filter(function(r){return pinned.indexOf(r)<0 && isMixed(r);});
      var rest=rows.filter(function(r){return pinned.indexOf(r)<0 && mixed.indexOf(r)<0;}).sort(configured);
      // Later slots first, so earlier inserts don't push them further down.
      mixed.map(function(row){return {row:row,slot:slotFor(row)};}).sort(function(a,b){return b.slot-a.slot||(a.row.id<b.row.id?1:-1);}).forEach(function(entry){
        rest.splice(Math.min(entry.slot,rest.length),0,entry.row);
      });
      var ordered=pinned.concat(rest),focused=doc.activeElement;
      ordered.forEach(function(row,index){if(row.style.order!==String(index+1))row.style.order=String(index+1);});
      // Jellyfin disconnect callbacks destroy native item renderer functions.
      // Native rows already follow configured order: only move our plain rows
      // among them, preserving native elements, handlers and keyboard traversal.
      var anchor=null;
      for(var i=ordered.length-1;i>=0;i--){
        var row=ordered[i];
        if(ours(row) && row.nextElementSibling!==anchor && !(anchor===null && !row.nextElementSibling))container.insertBefore(row,anchor);
        anchor=row;
      }
      if(focused && doc.activeElement!==focused && focused.isConnected)focused.focus({preventScroll:true});
    }
    function cardsIn(container){return Array.prototype.slice.call(container.querySelectorAll('.ContinueWatchingNextUp .card[data-id],.ContinueWatching .card[data-id],.resumeSection .card[data-id]'));}
    function syncCards(container){
      var next=Object.create(null),changed=false;
      cardsIn(container).forEach(function(card){
        var id=card.getAttribute('data-id');if(!id || next[id])return;next[id]=card;
        // Native playback/played-state refresh can replace the same item IDs.
        // Those new nodes need fresh user data, not the previous minute's cache.
        if(cardNodes[id] && cardNodes[id]!==card){delete cache[id];changed=true;}
      });
      Object.keys(cardNodes).forEach(function(id){if(!next[id]){delete cache[id];changed=true;}});
      cardNodes=next;
      if(changed){epoch++;pending=false;}
    }
    function dedupe(container){
      container.querySelectorAll('.ContinueWatchingNextUp,.ContinueWatching,.resumeSection').forEach(function(section){
        var cards=Array.prototype.slice.call(section.querySelectorAll('.card[data-id]'));
        var items=cards.map(function(card){return cache[card.getAttribute('data-id')];}).filter(Boolean);
        var keep=latestPerSeries(items).map(function(item){return item.Id;}),seen=Object.create(null);
        cards.forEach(function(card){
          var id=card.getAttribute('data-id'),item=cache[id],hide=!!item && (keep.indexOf(id)<0 || !!seen[id]);seen[id]=true;
          if(hide && card.contains(doc.activeElement)){
            var winner=cards.filter(function(c){var v=cache[c.getAttribute('data-id')];return v && v.SeriesId===item.SeriesId && keep.indexOf(v.Id)>=0;})[0];
            var target=winner && winner.querySelector('a,button,[tabindex="0"]');if(target)target.focus({preventScroll:true});
          }
          if(hide){if(!card.hasAttribute('data-zoro-duplicate'))card.setAttribute('data-zoro-duplicate','true');}
          else card.removeAttribute('data-zoro-duplicate');
        });
        hiddenLast(cards);
      });
    }
    // jellyfin-web's row arrows step by children[n].offsetWidth, counting
    // hidden children too, so a hidden card at that index makes the arrow
    // scroll to 0 (nowhere). Keep hidden duplicates after every visible card,
    // in their original order, so arrows and keyboard focus only meet real cards.
    var position=new WeakMap(),nextPosition=0;
    function hiddenLast(cards){
      var parents=[];
      cards.forEach(function(card){
        if(!position.has(card))position.set(card,nextPosition++);
        if(card.parentNode && card.parentNode.appendChild && parents.indexOf(card.parentNode)<0)parents.push(card.parentNode);
      });
      parents.forEach(function(parent){
        var own=cards.filter(function(card){return card.parentNode===parent;});
        var rank=function(card){return card.hasAttribute('data-zoro-duplicate')?1:0;};
        var wanted=own.slice().sort(function(a,b){return rank(a)-rank(b) || position.get(a)-position.get(b);});
        if(wanted.every(function(card,i){return card===own[i];}))return;
        var focused=doc.activeElement;
        wanted.forEach(function(card){parent.appendChild(card);});
        if(focused && doc.activeElement!==focused && focused.isConnected)focused.focus({preventScroll:true});
      });
    }
    function refresh(){
      scheduled=false;var current=who();
      if(identity!==current){identity=current;epoch++;cache=Object.create(null);cardNodes=Object.create(null);pending=false;restoreCards();}
      clearTimeout(timer);timer=null;var container=host();
      if(!container || !identity)return;
      syncCards(container);arrange(container);dedupe(container);
      timer=setTimeout(invalidate,60000);
      if(pending)return;
      var ids=cardsIn(container).map(function(c){return c.getAttribute('data-id');}).filter(function(id,index,all){return id && !cache[id] && all.indexOf(id)===index;});
      if(!ids.length)return;
      var serial=epoch,source=identity,client=root.ApiClient;pending=true;
      var queue=ids.slice();
      function page(){
        var batch=queue.splice(0,200);
        return client.getItems(client.getCurrentUserId(),{Ids:batch.join(','),Fields:'SeriesInfo',EnableUserData:true,Limit:200}).then(function(result){
          if(serial!==epoch || source!==who() || !host())return;
          (result.Items||[]).forEach(function(item){cache[item.Id]=item;});
          // Cache inaccessible IDs without grouping them; never hide on lookup failure.
          batch.forEach(function(id){if(!cache[id])cache[id]={Id:id};});
          dedupe(container);if(queue.length)return page();
        });
      }
      Promise.resolve().then(page).catch(function(){}).then(function(){if(serial===epoch)pending=false;});
    }
    function schedule(){if(scheduled)return;scheduled=true;setTimeout(refresh,100);}
    function invalidate(){epoch++;pending=false;cache=Object.create(null);cardNodes=Object.create(null);restoreCards();schedule();}
    var style=doc.createElement('style');
    style.textContent=[
      '[data-zoro-duplicate="true"]{display:none!important}',
      // Short phone viewports can put Play underneath the fixed navigation dock.
      'html.zoro-ui.zoro-mobile-flow.zoro-native-home #slides-container{',
      '--zoro-banner-clearance:calc(var(--zoro-mobile-banner-top,178px) + max(80px,var(--zoro-shell-footer,80px)));',
      'max-height:max(128px,calc(100vh - var(--zoro-banner-clearance)))!important;',
      'max-height:max(128px,calc(100dvh - var(--zoro-banner-clearance)))!important;}',
      'html.zoro-ui.zoro-mobile-flow.zoro-native-home #slides-container .logo-container{bottom:max(27%,calc(7% + 78px))!important;height:min(24%,calc(93% - 84px))!important;}',
      'html.zoro-ui.zoro-mobile-flow.zoro-native-home #slides-container .info-container{bottom:max(20%,calc(7% + 54px))!important;}'
    ].join('');
    doc.head.appendChild(style);
    doc.addEventListener('click',playBanner,true);
    new root.MutationObserver(function(){guardHomePagination();schedule();}).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-id']});
    guardHomePagination();
    root.addEventListener('hashchange',invalidate);
    root.addEventListener('focus',invalidate);
    doc.addEventListener('visibilitychange',function(){if(doc.hidden)schedule();else invalidate();});schedule();
  }
  return {latestPerSeries:latestPerSeries,mount:mount};
}));
