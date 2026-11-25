/* Episode browser and current-channel schedule for the plugin's web player.
 * Reads use the active account/device. Switching an episode is an explicit
 * call to Jellyfin's own playback manager; this module never owns a video. */
(function(root){
  'use strict';if(!root||!root.document||root.zorofinPlayerBrowserLoaded)return;root.zorofinPlayerBrowserLoaded=true;
  var actions=new WeakMap();
  var doc=root.document,host=null,panel=null,panelTimer=null,trigger=null,account='',epoch=0,item=null,lastRead=0,pending=false,readId=0,timer=null,manager=null,selection=0;
  function who(){try{var a=root.ApiClient;return a&&a.accessToken()&&a.getCurrentUserId()?a.serverId()+':'+a.getCurrentUserId()+':'+a.accessToken():'';}catch(_){return '';}}
  function active(){return doc.querySelector('#videoOsdPage:not(.hide) #zoroPlayer')&&doc.querySelector('.videoPlayerContainer video,video.htmlvideoplayer');}
  function el(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  function button(text,run){var b=el('button','zoroPbChoice focusable',text);b.type='button';actions.set(b,run);return b;}
  function read(fn){var timeout;return Promise.race([Promise.resolve().then(fn),new Promise(function(_,reject){timeout=root.setTimeout(function(){reject(new Error('Read timed out'));},10000);})]).finally(function(){root.clearTimeout(timeout);});}
  function close(restore){selection++;root.clearTimeout(panelTimer);panelTimer=null;if(panel)panel.remove();panel=null;if(restore&&trigger&&trigger.isConnected)trigger.focus();trigger=null;}
  function nativeManager(){
    if(manager)return manager;
    var chunks=root.webpackChunk;if(!chunks||chunks.push===Array.prototype.push)return null;
    try{chunks.push([[Symbol('zorofin-episode-play')],{},function(require){
      var id=Object.keys(require.m||{}).find(function(k){var s=Function.prototype.toString.call(require.m[k]);return /\.translateItemsForPlayback\s*=/.test(s)&&/\.getItemsForPlayback\s*=/.test(s);});
      if(id)manager=Object.values(require(id)).find(function(v){return v&&typeof v.play==='function'&&typeof v.getCurrentPlayer==='function';});
    }]);}catch(_){}return manager;
  }
  function show(b,title){
    if(panel&&trigger===b){close(true);return null;}close(false);trigger=b;panel=el('section','zoroPlayerBrowser');panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);
    var header=el('div','zoroPbHeading');header.append(el('h2','',title),button('Close',function(){close(true);}));panel.appendChild(header);doc.body.appendChild(panel);header.querySelector('button').focus();return panel;
  }
  function message(box,title,detail,retry){box.replaceChildren(el('h3','',title),el('p','',detail));box.setAttribute('role','status');if(retry)box.appendChild(button('Try again',retry));}
  function skeleton(box,title){message(box,title,'Playback continues while you browse.');box.setAttribute('aria-busy','true');var s=el('div','zoroPbSkeleton');s.setAttribute('aria-hidden','true');for(var i=0;i<3;i++)s.appendChild(el('span'));box.appendChild(s);}
  function episodes(b){
    var current=item,client=root.ApiClient,source=who(),run=epoch,view=show(b,'Seasons & episodes');if(!view||!current)return;
    var field=el('label','zoroPbSeason','Season'),select=el('select','focusable'),list=el('div','zoroPbList');field.appendChild(select);view.append(field,list);select.setAttribute('aria-label','Choose season');
    function valid(){return panel===view&&run===epoch&&source===who()&&active();}
    function loadSeason(focusCurrent){
      if(!valid())return;var chosen=select.value,request=++selection;skeleton(list,'Loading episodes…');
      read(function(){return client.getEpisodes(current.SeriesId,{SeasonId:chosen,UserId:client.getCurrentUserId(),Fields:'UserData,Overview,PrimaryImageAspectRatio,RunTimeTicks'});}).then(function(result){
        if(!valid()||request!==selection)return;if(!result||!Array.isArray(result.Items))throw new Error('Invalid episodes');list.replaceChildren();list.removeAttribute('aria-busy');
        var seen=new Set(),rows=result.Items.filter(function(e){if(!e.Id||seen.has(e.Id))return false;seen.add(e.Id);return true;}).sort(function(a,b){return Number(a.IndexNumber||0)-Number(b.IndexNumber||0);});
        if(!rows.length){message(list,'This season has no episodes','Choose another season, or check again when episodes have been added.',loadSeason);return;}
        rows.forEach(function(e){
          var row=el('div','zoroPbEpisode');if(e.Id===current.Id)row.setAttribute('aria-current','true');
          if(e.ImageTags&&e.ImageTags.Primary&&client.getImageUrl){var img=el('img');img.alt='';img.loading='lazy';img.src=client.getImageUrl(e.Id,{type:'Primary',tag:e.ImageTags.Primary,maxWidth:320});row.appendChild(img);}
          var description=el('div','zoroPbDescription');description.append(el('strong','',(e.IndexNumber?'E'+e.IndexNumber+' · ':'')+e.Name),el('p','',e.Id===current.Id?'Currently playing':e.UserData&&e.UserData.Played?'Watched':''));
          var unavailable=e.IsMissing===true||e.IsVirtualUnaired===true||e.LocationType==='Virtual';
          if(unavailable)description.appendChild(el('p','','Unavailable · No playable media yet'));
          var player=!unavailable&&nativeManager();
          if(player){var pick=button(e.Id===current.Id?'Playing':e.UserData&&e.UserData.PlaybackPositionTicks>0?'Resume':'Play',function(){
            if(!valid())return;var play=nativeManager();if(!play)return;pick.disabled=true;
            Promise.resolve().then(function(){return play.play({ids:[e.Id],serverId:client.serverId(),startPositionTicks:Number(e.UserData&&e.UserData.PlaybackPositionTicks)||0});}).then(function(){if(valid())close(false);}).catch(function(){if(valid()){pick.disabled=false;var err=description.querySelector('[role=alert]')||el('p');err.setAttribute('role','alert');err.textContent='Couldn’t start this episode. Try again.';description.appendChild(err);}});
          });pick.disabled=e.Id===current.Id;description.appendChild(pick);}
          else {var link=el('a','zoroPbChoice','View episode details');link.href='#/details?id='+encodeURIComponent(e.Id)+'&serverId='+encodeURIComponent(client.serverId());description.appendChild(link);}
          row.appendChild(description);list.appendChild(row);
        });
        if(focusCurrent===true){var playing=list.querySelector('[aria-current=true]');if(playing)playing.scrollIntoView({block:'nearest'});}
      }).catch(function(){if(valid()&&request===selection){list.removeAttribute('aria-busy');message(list,'Episodes couldn’t load','Your selected season is kept. Try again or choose another season.',loadSeason);}});
    }
    function seasons(){
      select.disabled=true;skeleton(list,'Loading seasons…');
      read(function(){return client.getSeasons(current.SeriesId,{userId:client.getCurrentUserId()});}).then(function(result){
        if(!valid())return;if(!result||!Array.isArray(result.Items))throw new Error('Invalid seasons');select.replaceChildren();
        result.Items.slice().sort(function(a,b){return Number(a.IndexNumber||0)-Number(b.IndexNumber||0);}).forEach(function(s){var o=el('option','',Number(s.IndexNumber)===0?'Specials':s.Name||'Season '+s.IndexNumber);o.value=s.Id;o.selected=s.Id===current.SeasonId;select.appendChild(o);});
        select.disabled=false;list.removeAttribute('aria-busy');if(!select.options.length){message(list,'No seasons available','No seasons are available to your account yet.',seasons);return;}loadSeason();
      }).catch(function(){if(valid()){list.removeAttribute('aria-busy');message(list,'Seasons couldn’t load','The current episode keeps playing.',seasons);}});
    }
    select.addEventListener('change',loadSeason);var currentButton=button('Current episode',function(){if(Array.from(select.options).some(function(o){return o.value===current.SeasonId;})){select.value=current.SeasonId;loadSeason(true);}});view.insertBefore(currentButton,list);seasons();
  }
  function schedule(b){
    var current=item,client=root.ApiClient,source=who(),run=epoch,view=show(b,'Channel schedule');if(!view||!current)return;var list=el('div','zoroPbList');view.appendChild(list);
    function valid(){return panel===view&&run===epoch&&source===who()&&active();}
    function load(){
      if(!valid())return;root.clearTimeout(panelTimer);skeleton(list,'Loading schedule…');var now=Date.now();
      read(function(){return client.getLiveTvPrograms({userId:client.getCurrentUserId(),channelIds:[current.Id],minEndDate:new Date(now).toISOString(),maxStartDate:new Date(now+8*3600000).toISOString(),limit:48,fields:'Overview'});}).then(function(result){
        if(!valid())return;if(!result||!Array.isArray(result.Items))throw new Error('Invalid schedule');list.removeAttribute('aria-busy');list.replaceChildren();
        var rows=result.Items.filter(function(p){return p.ChannelId===current.Id&&Number.isFinite(Date.parse(p.StartDate))&&Date.parse(p.EndDate)>Date.now();}).sort(function(a,b){return Date.parse(a.StartDate)-Date.parse(b.StartDate);});
        if(!rows.length){message(list,'No schedule available','This channel is still playing. Check again for guide updates.',load);return;}
        panelTimer=root.setTimeout(function(){if(valid())load();},60000);
        rows.forEach(function(p){var row=el('article','zoroPbProgram'),on=Date.parse(p.StartDate)<=Date.now();row.append(el('small','',on?'On now':'Up next'),el('h3','',root.zorofinLiveEventTools?root.zorofinLiveEventTools.cleanTitle(p):p.Name||'Scheduled program'),el('p','',new Date(p.StartDate).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' – '+new Date(p.EndDate).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})));if(on)row.setAttribute('aria-current','true');list.appendChild(row);});
      }).catch(function(){if(valid()){list.removeAttribute('aria-busy');message(list,'Schedule couldn’t load','Playback continues. Try the guide again.',load);}});
    }load();
  }
  function controls(){
    if(!host)return;var allowed=item&&item.Type==='Episode'&&item.SeriesId&&typeof root.ApiClient.getSeasons==='function'&&typeof root.ApiClient.getEpisodes==='function';
    var live=item&&/^(TvChannel|LiveTvChannel)$/.test(item.Type)&&typeof root.ApiClient.getLiveTvPrograms==='function';
    [['episodes',allowed,'Seasons & episodes','video_library',episodes],['schedule',live,'Channel schedule','view_list',schedule]].forEach(function(c){
      var b=host.querySelector('[data-zoro-browser="'+c[0]+'"]');if(!c[1]){if(b)b.remove();return;}if(b)return;
      b=button('',function(){c[4](b);});b.className='zp-tool';b.dataset.zoroBrowser=c[0];b.title=c[2];b.setAttribute('aria-label',c[2]);var icon=el('span','material-icons',c[3]);icon.setAttribute('aria-hidden','true');b.appendChild(icon);host.prepend(b);
    });
  }
  function check(){
    var tools=active()&&doc.querySelector('#zoroPlayer .zp-tools'),identity=who();
    if(tools!==host||identity!==account){close(false);epoch++;pending=false;item=null;lastRead=0;if(host)host.querySelectorAll('[data-zoro-browser]').forEach(function(b){b.remove();});host=tools;account=identity;}
    if(!host||!identity){if(timer)root.clearInterval(timer);timer=null;return;}if(!timer)timer=root.setInterval(check,15000);if(doc.hidden)return;controls();
    var client=root.ApiClient;if(pending||Date.now()-lastRead<14000||typeof client.getSessions!=='function'||typeof client.deviceId!=='function')return;
    pending=true;lastRead=Date.now();var request=++readId,run=epoch,device=client.deviceId();
    read(function(){return client.getSessions({deviceId:device});}).then(function(sessions){
      if(run!==epoch||identity!==who()||!active())return;var session=(sessions||[]).find(function(s){return s.DeviceId===device&&(!s.UserId||s.UserId===client.getCurrentUserId());});var next=session&&session.NowPlayingItem;
      if((item&&item.Id)!==(next&&next.Id)){close(false);epoch++;}item=next||null;controls();
    }).catch(function(){if(run===epoch){item=null;close(false);controls();}}).finally(function(){if(request===readId)pending=false;});
  }
  root.addEventListener('click',function(e){var target=e.target.closest&&e.target.closest('[data-zoro-browser],.zoroPlayerBrowser');if(!target)return;e.stopImmediatePropagation();var b=e.target.closest('button'),run=b&&actions.get(b);if(run){e.preventDefault();if(!b.disabled)run();}},true);
  // Let panel controls run their handlers, while keeping Jellyfin's video-press
  // handler from treating a browse gesture as play/pause.
  doc.addEventListener('keydown',function(e){if(panel&&(e.key==='Escape'||e.key==='GoBack'||e.key==='BrowserBack'||e.keyCode===461||e.keyCode===10009)){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
  new root.MutationObserver(check).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});root.addEventListener('hashchange',check);check();
}(typeof window==='undefined'?null:window));
