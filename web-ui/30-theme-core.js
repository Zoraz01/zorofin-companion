/* Restore the retired presentation trial journal on returning clients.
 * No user-agent detection, input handlers, visual overrides or timers. */
(function () {
  'use strict';
  var journal = 'zorofin-lg-lightweight-backup-v1';
  var keys = ['mediaBarEnhanced-enabled', 'mediaBarEnhanced-enableLoadingScreen'];
  try {
    var raw = localStorage.getItem(journal);
    if (!raw) return;
    var backup = JSON.parse(raw);
    if (!backup || backup.version !== 1 || !backup.values || keys.some(function (key) {
      return !Object.prototype.hasOwnProperty.call(backup.values, key) ||
        (backup.values[key] !== null && typeof backup.values[key] !== 'string');
    })) return;
    keys.forEach(function (key) {
      // Keep preferences edited by the viewer after the trial.
      if (localStorage.getItem(key) !== 'false') return;
      if (backup.values[key] === null) localStorage.removeItem(key);
      else localStorage.setItem(key, backup.values[key]);
    });
    localStorage.removeItem(journal);
  } catch (_) { /* Unavailable storage must never block the UI. */ }
})();

/* Profile-only room UI for Jellyfin's built-in SyncPlay manager and APIs. */
(function (root) {
  'use strict';
  if (!root.document || root.ZorofinWatchTogether) return;
  var doc = root.document, state = {key:'',client:null,user:null,manager:null,events:null,handlers:[],
    row:null,panel:null,host:null,hidden:[],groups:[],busy:false,error:'',creating:false,name:'Movie night',
    confirming:false,loading:false,timer:null,loadTask:null,sequence:0,status:'',uncertain:false,renderKey:'',permissionRetry:0};
  var mountQueued=false;
  function make(tag,cls,text) { var el=doc.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el; }
  function icon(name) {var el=make('span','material-icons',name);el.setAttribute('aria-hidden','true');return el;}
  function identity() {try {var c=root.ApiClient;return c&&c.getCurrentUserId()&&c.accessToken()?[c.serverId(),c.getCurrentUserId(),c.accessToken()].join(':'):'';}catch(_){return '';}}
  function profileRoute() {return String(root.location.hash).split('?')[0]==='#/mypreferencesmenu';}
  function opened() {return profileRoute()&&new URLSearchParams(String(root.location.hash).split('?')[1]||'').get('watchTogether')==='1';}
  function currentGroup() {return state.manager&&state.manager.getApiClient()===state.client&&state.manager.isSyncPlayEnabled()?state.manager.getGroupInfo():null;}
  function canCreate() {return state.user&&state.user.Policy&&state.user.Policy.SyncPlayAccess==='CreateAndJoinGroups';}
  function allowed() {var access=state.user&&state.user.Policy&&state.user.Policy.SyncPlayAccess;return access==='CreateAndJoinGroups'||access==='JoinGroups';}
  function restore() {
    if(state.host)state.host.classList.remove('zoro-watch-together-open');
    state.hidden.forEach(function(entry){if(entry.node.dataset.zoroGroupHidden==='true'){entry.node.hidden=entry.hidden;delete entry.node.dataset.zoroGroupHidden;}});
    state.hidden=[];
    if(state.panel)state.panel.remove();state.panel=null;state.renderKey='';
    root.clearTimeout(state.timer);state.timer=null;
  }
  function reset(key) {
    restore();state.handlers.forEach(function(h){try {state.events.off(state.manager,h[0],h[1]);}catch(_){}});
    // Clear local state on account changes without sending a request using a
    // possibly replaced token. Jellyfin owns server-session sign-out cleanup.
    if(state.manager&&state.key&&state.key!==key)state.manager.disableSyncPlay(false);
    if(state.row)state.row.remove();
    state.key=key;state.client=root.ApiClient;state.user=null;state.manager=null;state.events=null;state.handlers=[];
    state.row=null;state.host=null;state.groups=[];state.busy=false;state.error='';state.creating=false;
    state.confirming=false;state.loading=false;state.loadTask=null;state.status='';state.uncertain=false;state.permissionRetry=0;state.sequence++;
  }
  // The native web client does not publish its module singleton as a window
  // global. Resolve the already-loaded core by its export contract, never by a
  // version-specific numeric module ID. Fail closed if that contract changes.
  // All queue/timing/player behavior continues to use Jellyfin's own instance.
  function nativeManager() {
    if(state.manager)return state.manager;
    var chunks=root.webpackChunk;
    if(!chunks||typeof chunks.push!=='function')return null;
    try {
      chunks.push([['zoro-watch-together-'+Date.now()+'-'+state.sequence],{},function(require){
        var modules=require.m||{},keys=Object.keys(modules);
        for(var i=0;i<keys.length;i++){
          var source=String(modules[keys[i]]);
          if(!/PlayerFactory\s*:/.test(source)||!/GenericPlayer\s*:/.test(source)||!/Manager\s*:/.test(source))continue;
          var exports=require(keys[i]),values=[exports].concat(Object.keys(exports||{}).map(function(k){return exports[k];}));
          var core=values.find(function(v){return v&&v.Manager&&v.PlayerFactory&&typeof v.Manager.getGroupInfo==='function';});
          if(core){state.manager=core.Manager;break;}
        }
      }]);
    }catch(_){return null;}
    if(state.manager&&root.Events){
      state.events=root.Events;
      ['enabled','group-update','group-state-update'].forEach(function(name){
        var listener=function(_event,value){if(identity()!==state.key)return;if(name==='group-state-update')state.status=value;if(currentGroup())state.uncertain=false;if(name==='enabled'&&!value)state.status='';updateRow();if(opened())render();};
        state.events.on(state.manager,name,listener);state.handlers.push([name,listener]);
      });
    }
    return state.manager;
  }
  async function decoded(result) {
    if(result&&typeof result.json==='function'){
      if(result.ok===false)throw Error('The server could not complete this group action.');
      return result.status===204?null:result.json();
    }
    return result;
  }
  function button(label,action,primary) {
    var b=make('button','zoroGroupButton focusable'+(primary?' zoroGroupPrimary':''),label);b.type='button';
    b.dataset.groupAction=action;b.disabled=state.busy&&action!=='back';return b;
  }
  function message(text,cls) {return make('p',cls||'zoroGroupMuted',text);}
  function groupTitle(group) {return String(group.GroupName||'Watch together');}
  function updateRow() {
    if(!state.row)return;
    var group=currentGroup(),name=state.row.querySelector('.zoroGroupRowName');
    state.row.hidden=!allowed();
    if(name&&name.textContent!==(group?groupTitle(group):''))name.textContent=group?groupTitle(group):'';
  }
  async function loadGroups() {
    if(state.loading||state.busy||!allowed()||!opened())return;
    var key=state.key,sequence=state.sequence,first=state.groups.length===0;
    state.loading=true;
    if(first&&!state.creating&&!currentGroup())render();
    try {
      var groups=await decoded(await state.client.getSyncPlayGroups());
      if(key!==identity()||sequence!==state.sequence)return;
      if(!Array.isArray(groups))throw Error('The server returned an unexpected group list.');
      var changed=JSON.stringify(groups)!==JSON.stringify(state.groups);
      state.groups=groups;
      if(state.error.indexOf('Groups could not be loaded.')===0)state.error='';
      if(changed&&!state.creating||!state.panel||!state.panel.children.length)render();
    }catch(_){if(key===identity()&&sequence===state.sequence){state.error='Groups could not be loaded. Check your connection and try again.';render();}}
    finally{
      if(key===identity()&&sequence===state.sequence){state.loading=false;
        if(first&&opened()&&!state.creating&&!state.busy&&!currentGroup())render();
        root.clearTimeout(state.timer);if(opened())state.timer=root.setTimeout(loadGroups,10000);
      }
    }
  }
  async function operation(kind,id) {
    if(state.busy||!allowed()||state.uncertain&&kind!=='reset'&&kind!=='continue')return;
    var key=state.key,sequence=state.sequence,submitted=false,acknowledged=false;
    state.error='';state.busy=true;render();
    try {
      var manager=nativeManager();
      if(!manager||manager.getApiClient()!==state.client)throw Error('Group watching is not available in this web client. Reopen the app and try again.');
      if(kind==='create'){
        var name=state.name.trim();if(!name||name.length>100)throw Error('Enter a group name of up to 100 characters.');
        if(!canCreate())throw Error('Your account can join groups but cannot create one.');
        submitted=true;await decoded(await state.client.createSyncPlayGroup({GroupName:name}));
      }else if(kind==='join'){
        submitted=true;await decoded(await state.client.joinSyncPlayGroup({GroupId:id}));
      }else if(kind==='leave'||kind==='reset'){
        submitted=true;await decoded(await state.client.leaveSyncPlayGroup());if(kind==='reset')state.uncertain=false;
      }else if(kind==='continue'){
        await manager.followGroupPlayback(state.client);
        if(key!==identity()||sequence!==state.sequence)return;
        await manager.getQueueCore().startPlayback(state.client);return;
      }
      // The socket acknowledgement, rather than just HTTP 204, establishes
      // membership and permissions. Jellyfin's manager consumes that message.
      for(var attempt=0;attempt<50;attempt++){
        if(key!==identity()||sequence!==state.sequence)return;
        var group=currentGroup();
        if((kind==='leave'||kind==='reset')?!group:group&&(kind!=='join'||group.GroupId===id)){acknowledged=true;break;}
        if(attempt===49)throw Error('The server did not confirm the group action. Refresh before trying again.');
        await new Promise(function(resolve){root.setTimeout(resolve,100);});
      }
      state.creating=false;state.confirming=false;
    }catch(error){if(key===identity()&&sequence===state.sequence){state.uncertain=submitted&&!acknowledged&&!currentGroup();state.error=state.uncertain?'The group action could not be confirmed. Reconnect before starting or joining another group.':error.message||'This group action failed. Try again.';}}
    finally {if(key===identity()&&sequence===state.sequence){state.busy=false;updateRow();if(opened()){render();loadGroups();}}}
  }
  function render() {
    if(!opened()||!state.host||!state.host.isConnected)return;
    state.host.classList.add('zoro-watch-together-open');
    var signature=JSON.stringify([state.creating,state.confirming,state.busy,state.error,state.uncertain,state.groups,currentGroup(),state.status,state.loading,state.user&&state.user.Policy]);
    if(state.panel&&state.panel.isConnected&&signature===state.renderKey)return;
    state.renderKey=signature;
    var active=doc.activeElement,focus=active&&state.panel&&state.panel.contains(active)?{action:active.dataset.groupAction,id:active.id,group:active.dataset.groupId,start:active.selectionStart,end:active.selectionEnd}:null;
    if(!state.panel){
      state.panel=make('section','zoroWatchTogetherPage');state.panel.id='zoroWatchTogetherPage';
      state.panel.setAttribute('aria-label','Watch together');state.host.appendChild(state.panel);
      state.panel.addEventListener('click',onClick);
      state.panel.addEventListener('input',function(event){if(event.target.id==='zoroGroupName')state.name=event.target.value;});
    }
    Array.from(state.host.children).forEach(function(node){if(node!==state.panel&&node.dataset.zoroGroupHidden!=='true'){
      state.hidden.push({node:node,hidden:node.hidden});node.dataset.zoroGroupHidden='true';node.hidden=true;
    }});
    var panel=state.panel;panel.replaceChildren();
    var back=button(state.creating?'Watch together':'Profile','back');back.classList.add('zoroGroupBack');back.prepend(icon('chevron_left'));panel.appendChild(back);
    panel.appendChild(make('h1','',state.creating?'Start a group':'Watch together'));
    var group=currentGroup();
    if(group){
      var card=make('div','zoroGroupCard');card.append(message('Your group'),make('h2','',groupTitle(group)));
      var queue=state.manager.getQueueCore(),items=queue.getPlaylist(),item=items[queue.getCurrentPlaylistIndex()];
      card.append(message(item?String(item.Name||'Group playback'):'Choose something to watch'));
      if((state.status||group.State)==='Waiting')card.append(message('Waiting for others…'));
      panel.appendChild(card);panel.appendChild(make('h2','zoroGroupSectionTitle','Participants'));
      (group.Participants||[]).forEach(function(name){var person=make('div','zoroGroupPerson');person.append(make('span','zoroGroupInitial',String(name).slice(0,1).toUpperCase()),make('span','',name));panel.appendChild(person);});
      if(state.confirming){panel.append(make('h2','zoroGroupSectionTitle','Leave this group?'),button('Leave group','confirm-leave'),button('Stay in group','stay'));}
      else {panel.append(button(item?'Continue watching':'Browse library',item?'continue':'browse',true),button('Leave group','leave'));}
    }else if(state.creating){
      panel.appendChild(message('Create a group, then choose something from your library.'));
      var label=make('label','zoroGroupField','Group name'),input=make('input','');label.htmlFor='zoroGroupName';
      input.id='zoroGroupName';input.value=state.name;input.maxLength=100;input.disabled=state.busy;
      input.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();operation('create');}});
      panel.append(label,input,button('Create group','confirm-create',true));
    }else{
      panel.appendChild(message(canCreate()?'Choose a group to join, or start one and invite others on this server.':'Choose a group on this server to join.'));
      var heading=make('div','zoroGroupSectionHeading'),refresh=button('Refresh','refresh');refresh.classList.add('zoroGroupRefresh');
      heading.append(make('h2','','Available groups'),refresh);panel.appendChild(heading);
      if(!state.groups.length)panel.appendChild(message(state.loading?'Loading groups…':'No groups right now','zoroGroupEmpty'));
      state.groups.forEach(function(g){
        var card=make('div','zoroGroupCard'),participants=g.Participants||[],join=button('Join','join');
        join.disabled=state.busy||state.uncertain;join.dataset.groupId=g.GroupId;join.setAttribute('aria-label','Join '+groupTitle(g));
        card.append(make('h2','',groupTitle(g)),message(participants.length+' '+(participants.length===1?'person':'people')),join);panel.appendChild(card);
      });
      if(canCreate()){var start=button('Start a group','start',true);start.disabled=state.busy||state.uncertain;panel.appendChild(start);}
    }
    if(state.busy){var busy=message('Updating group…');busy.setAttribute('role','status');panel.appendChild(busy);}
    if(state.uncertain)panel.appendChild(button('Reconnect group session','reset'));
    if(state.error){var error=message(state.error,'zoroGroupError');error.setAttribute('role','alert');panel.append(error,button('Refresh groups','refresh'));}
    if(focus){var target=Array.from(panel.querySelectorAll('button,input')).find(function(el){return focus.id?el.id===focus.id:el.dataset.groupAction===focus.action&&el.dataset.groupId===focus.group;});
      if(target&&!target.disabled){target.focus({preventScroll:true});if(focus.id&&typeof focus.start==='number')target.setSelectionRange(focus.start,focus.end);}
      else {var next=panel.querySelector('button:not(:disabled):not(.zoroGroupBack)')||back;next.focus({preventScroll:true});}
    }
  }
  function onClick(event) {
    var target=event.target.closest('[data-group-action]');if(!target)return;
    var action=target.dataset.groupAction;
    if(action==='back'){
      if(state.confirming){state.confirming=false;render();return;}
      if(state.creating){state.creating=false;state.error='';render();return;}
      root.location.hash='#/mypreferencesmenu';restore();if(state.row)state.row.focus();return;
    }
    if(action==='browse'){root.location.hash='#/home';restore();return;}
    if(action==='start'){if(state.uncertain)return;state.creating=true;state.error='';render();var input=doc.getElementById('zoroGroupName');if(input)input.focus();return;}
    if(action==='leave'||action==='stay'){state.confirming=action==='leave';render();return;}
    if(action==='refresh'){state.error='';nativeManager();loadGroups();return;}
    if(action==='reset')operation('reset');
    if(action==='confirm-create')operation('create');
    if(action==='confirm-leave')operation('leave');
    if(action==='join')operation('join',target.dataset.groupId);
    if(action==='continue')operation('continue');
  }
  function sync() {
    var key=identity();if(key!==state.key)reset(key);
    if(!opened())restore();
  }
  function mount(host) {
    sync();if(!state.key||!host)return;
    if(state.host!==host){restore();state.host=host;}
    if(!state.user){
      if(state.loadTask)return;if(Date.now()<state.permissionRetry){root.clearTimeout(state.timer);state.timer=root.setTimeout(scheduleMount,state.permissionRetry-Date.now());return;}
      var key=state.key,sequence=state.sequence;
      state.loadTask=state.client.getCurrentUser().then(function(user){
        if(key!==identity()||sequence!==state.sequence)return;
        if(user.Id&&user.Id!==state.client.getCurrentUserId())return;state.user=user;scheduleMount();if(root.ZorofinShell)root.ZorofinShell.refresh();
      }).catch(function(){if(key===identity()&&sequence===state.sequence){state.permissionRetry=Date.now()+5000;root.clearTimeout(state.timer);state.timer=root.setTimeout(scheduleMount,5000);}})
        .finally(function(){if(key===identity()&&sequence===state.sequence)state.loadTask=null;});return;
    }
    if(!allowed()){if(state.row)state.row.remove();restore();return;}
    if(!state.row||!state.row.isConnected||!host.contains(state.row)){
      if(state.row)state.row.remove();
      var row=make('button','zoroProfileShortcut zoroWatchTogetherEntry focusable');row.type='button';
      var copy=make('span','zoroGroupRowCopy');copy.append(make('span','','Watch together'),make('span','zoroGroupRowName',''));
      row.append(icon('groups'),copy,icon('chevron_right'));
      row.addEventListener('click',function(){nativeManager();state.creating=false;state.confirming=false;root.location.hash='#/mypreferencesmenu?watchTogether=1';render();loadGroups();root.requestAnimationFrame(function(){if(state.panel){var back=state.panel.querySelector('[data-group-action="back"]');if(back)back.focus();}});});
      var quick=host.querySelector('a[href*="quickconnect" i]');
      var anchor=quick&&(quick.closest('.listItem-border')||quick);
      if(anchor)anchor.after(row);else {var display=host.querySelector('a[href*="mypreferencesdisplay"]');var before=display&&(display.closest('.listItem-border')||display);if(before)before.before(row);else host.insertBefore(row,host.querySelector('.zoroProfileShortcuts'));}
      state.row=row;
    }
    updateRow();
    if(opened()){
      host.classList.add('zoro-watch-together-open');
      nativeManager();
      if(!state.panel||!state.panel.isConnected){state.panel=null;render();}
      if(!state.timer&&!state.loading)loadGroups();
    }
  }
  root.ZorofinWatchTogether={mount:mount,sync:sync};
  // Also support a scoped authenticated module release without replacing the
  // installed browsing shell or theme. Ignore our own content mutations.
  function scheduleMount() {
    if(mountQueued)return;mountQueued=true;
    root.requestAnimationFrame(function(){
      mountQueued=false;sync();
      var changed=false;
      doc.querySelectorAll('.skinHeader button').forEach(function(button){
        var label=button.getAttribute('aria-label')||button.title||'';
        if((/^syncplay$/i.test(label)||button.matches('.headerSyncButton,.headerSyncPlayButton'))&&!button.hidden){button.hidden=true;changed=true;}
      });
      if(changed&&root.ZorofinShell)root.ZorofinShell.refresh();
      if(!profileRoute())return;
      var host=doc.querySelector('#myPreferencesMenuPage:not(.hide) .readOnlyContent');
      if(host)mount(host);
    });
  }
  root.addEventListener('hashchange',function(){sync();if(opened()&&state.host){render();loadGroups();}scheduleMount();});
  doc.addEventListener('viewshow',scheduleMount);
  doc.addEventListener('keydown',function(event){
    if(!opened()||event.defaultPrevented||!['Escape','BrowserBack','GoBack'].includes(event.key))return;
    // Text entry owns its first Back; the next Back leaves this Profile screen.
    if(doc.activeElement&&doc.activeElement.tagName==='INPUT'){doc.activeElement.blur();return;}
    event.preventDefault();event.stopPropagation();onClick({target:{closest:function(){return {dataset:{groupAction:'back'}};}}});
  },true);
  function start(){
    new root.MutationObserver(function(records){
      if(records.some(function(record){return !record.target.closest||!record.target.closest('#zoroWatchTogetherPage,.zoroWatchTogetherEntry');}))scheduleMount();
    }).observe(doc.body,{childList:true,subtree:true});
    scheduleMount();
  }
  if(doc.body)start();else doc.addEventListener('DOMContentLoaded',start,{once:true});
})(window);

/* Zorofin browsing shell. Native pages, cards, settings and playback stay owned by Jellyfin. */
(function initialize(root) {
  'use strict';
  var VERSION = '1.6.0';
  var DESTINATIONS = [
    {key:'home', label:'Home', icon:'home', href:'#/home'},
    {key:'search', label:'Search', icon:'search', href:'#/search'},
    {key:'requests', label:'Requests', icon:'add_to_queue', href:'#/home?zorofin=requests&view=discover'},
    {key:'profile', label:'Profile', icon:'person', href:'#/mypreferencesmenu'}
  ];
  var LIBRARIES = [
    {key:'movies',label:'Movies',icon:'movie',pattern:/collectionType=movies|#\/movies(?:\?|$)/i},
    {key:'shows',label:'Shows',icon:'tv',pattern:/collectionType=tvshows|#\/tv(?:\?|$)/i},
    {key:'livetv',label:'Live TV',icon:'live_tv',pattern:/collectionType=livetv|#\/livetv(?:\?|$)/i}
  ];
  function route(hash) {
    var parts = String(hash || '').split('?'), path = parts[0].replace(/\.html$/, '');
    if (path === '#/home') return new URLSearchParams(parts[1] || '').get('zorofin') === 'requests' ? 'requests' : 'home';
    if (path === '#/search') return 'search';
    if (path === '#/details') return 'detail';
    if (path === '#/mypreferencesmenu') return 'profile';
    if (/^#\/(?:userprofile|quickconnect|mypreferences(?:display|home|playback|subtitles|controls))$/.test(path)) return 'settings';
    return /^#\/(livetv|movies|tv|list|collection|library|boxsets|favorites)(?:$|\/)/.test(path) ? 'browse' : '';
  }
  if (typeof module === 'object' && module.exports) { module.exports={VERSION:VERSION,DESTINATIONS:DESTINATIONS,route:route}; return; }
  if (!root || !root.document || root.ZorofinShell) return;
  if (!root.document.body) {root.document.addEventListener('DOMContentLoaded',function(){initialize(root);},{once:true});return;}
  var doc=root.document, html=doc.documentElement;
  var state={nav:null,header:null,queued:false,identity:'',extras:null,notification:null,controller:null,returnFocus:null,hiddenControls:new Set(),passes:0,blocked:false,contentFocus:null,route:'',libraryLinks:[],libraryReady:false,libraryPending:false,libraryAttempts:0,libraryRetry:null,admin:null,adminPending:false,user:null};
  var api=root.ZorofinShell={version:VERSION,active:false,refresh:schedule,navigate:navigate};
  function identity() { try { var c=root.ApiClient;return c&&c.getCurrentUserId()&&c.accessToken() ? [c.serverId(),c.getCurrentUserId(),c.accessToken()].join(':') : ''; } catch (_) {return '';} }
  function wide() {return root.innerWidth>599||tv();}
  function tv() {return html.classList.contains('layout-tv')||doc.body.classList.contains('layout-tv');}
  function visible(el) {return el&&el.isConnected&&!el.closest('.hide,[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0;}
  function make(tag,cls,text) {var el=doc.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
  function icon(name) {var el=make('span','material-icons zoroShellIcon',name);el.setAttribute('aria-hidden','true');return el;}
  function loadLibraries() {
    var client=root.ApiClient,key=identity();
    if(!key||state.libraryReady||state.libraryPending||state.libraryRetry||state.libraryAttempts>=3||!client||typeof client.getUserViews!=='function')return;
    state.libraryPending=true;state.libraryAttempts++;
    Promise.resolve().then(function(){return client.getUserViews({},client.getCurrentUserId());}).then(function(result){
      if(key!==identity()||key!==state.identity)return;
      if(!result||!Array.isArray(result.Items))throw new Error('Library views unavailable');
      var types={movies:'movies',shows:'tvshows',livetv:'livetv'};
      state.libraryLinks=LIBRARIES.map(function(d){
        var item=result.Items.find(function(view){return view.CollectionType===types[d.key];});
        if(!item)return null;
        return {key:d.key,label:d.label,icon:d.icon,href:'#/'+(d.key==='shows'?'tv':d.key)+'?collectionType='+types[d.key]+(item.Id?'&topParentId='+encodeURIComponent(item.Id):'')};
      }).filter(Boolean);
      state.libraryReady=true;state.libraryPending=false;schedule();
    }).catch(function(){
      if(key!==identity()||key!==state.identity)return;
      state.libraryPending=false;
      if(state.libraryAttempts<3)state.libraryRetry=root.setTimeout(function(){state.libraryRetry=null;if(key===identity())schedule();},state.libraryAttempts*2000);
    });
  }
  function libraries() {
    // Modern may never populate the hidden Legacy drawer. The user's server
    // views are authoritative and include only libraries they can access.
    loadLibraries();
    if(state.libraryReady)return state.libraryLinks;
    var links=Array.from(doc.querySelectorAll('.mainDrawer a[href]'));
    var found=LIBRARIES.map(function(d){var a=links.find(function(el){return d.pattern.test(el.getAttribute('href'));});return a?{key:d.key,label:d.label,icon:d.icon,href:a.getAttribute('href')}:null;}).filter(Boolean);
    // Keep a same-account fallback while loading/retrying. A partially rebuilt
    // drawer must not remove destinations that were already discovered.
    if(found.length)state.libraryLinks=LIBRARIES.map(function(d){return found.find(function(link){return link.key===d.key;})||state.libraryLinks.find(function(link){return link.key===d.key;});}).filter(Boolean);
    return state.libraryLinks;
  }
  function navigate(key) {
    var dest=DESTINATIONS.concat(libraries()).find(function(d){return d.key===key;});if(!dest)return;
    root.setTimeout(focusContent,0);
    if(key==='requests'&&root.ZorofinRequests){root.ZorofinRequests.open();schedule();return;}
    if(root.ZorofinRequests&&doc.getElementById('zoroRequestsHub'))root.ZorofinRequests.close(dest.href);
    else root.location.hash=dest.href;
    schedule();
  }
  function nav() {
    var n=state.nav;
    if(!n||!n.isConnected){
      n=make('nav','zoroGlobalNav focuscontainer-x');n.id='zoroGlobalNav';n.setAttribute('aria-label','Main navigation');
      n.addEventListener('click',function(e){var a=e.target.closest('[data-destination]');if(!a||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();navigate(a.dataset.destination);});
      // Outside the animated native header: phone fixed positioning must not inherit its transform.
      doc.body.insertBefore(n,doc.body.firstChild);state.nav=n;

    }
    var drawer=doc.querySelector('.mainDrawer-scrollContainer');
    if(drawer)n.querySelectorAll('.pluginMenuOptions').forEach(function(menu){menu.classList.remove('marker');drawer.appendChild(menu);});
    var main=wide()?[DESTINATIONS[0]].concat(libraries().map(function(d){return Object.assign({},d,{label:d.key==='shows'?'TV Shows':d.label});}),DESTINATIONS[2]):DESTINATIONS,profile=wide()?[DESTINATIONS[3]]:[],key=JSON.stringify([main,profile,tv()]);
    if(n.dataset.structure===key)return;
    var focused=n.contains(doc.activeElement)&&doc.activeElement.dataset.destination;
    n.replaceChildren();n.dataset.structure=key;
    (tv()?[[main,'zoroNavMain'],[profile,'zoroNavProfile']]:[[profile,'zoroNavProfile'],[main,'zoroNavMain']]).forEach(function(group){
      if(!group[0].length)return;var host=make('div',group[1]);
      group[0].forEach(function(d){var a=make('a','focusable');a.href=d.href;a.dataset.destination=d.key;a.append(icon(d.icon),make('span','',d.label));host.appendChild(a);});n.appendChild(host);
    });
    if(wide()){var brand=make(tv()?'div':'a','zoroBrand');if(!tv())brand.href='#/home';var logo=make('img');logo.src=window.ZorofinWeb.base+''+(tv()?'mark-512.png':'wordmark.png');logo.alt='Zorofin';brand.appendChild(logo);if(tv())n.prepend(brand);else n.appendChild(brand);}
    if(focused){var target=n.querySelector('[data-destination="'+focused+'"]');if(target)target.focus({preventScroll:true});}
  }
  function focusContent() {
    var hub=doc.getElementById('zoroRequestsHub');
    if(hub){
      // Enter Requests in browsing mode. Search is focused only by deliberate input navigation.
      var entry=tv()&&hub.querySelector('.rh-tabs [aria-current="page"]');
      (entry&&visible(entry)?entry:hub).focus({preventScroll:true});return;
    }
    var scope=Array.from(doc.querySelectorAll('.mainAnimatedPages .page')).find(visible);
    var target=scope&&Array.from(scope.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select')).find(visible);
    if(target)target.focus({preventScroll:true});
  }
  function navigationKeys(e) {
    if(e.defaultPrevented||!api.active||!wide()||!tv()||!state.nav||state.blocked||e.altKey||e.ctrlKey||e.metaKey)return;
    // A dialog may mount before the next shell frame updates state.blocked.
    // Let its own Back/Escape handler receive the first remote key immediately.
    if(Array.from(doc.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(visible))return;
    var search=state.header.querySelector('.headerSearchButton,[data-action="search"]'),active=doc.activeElement;
    // On the wide Requests row, keep Right within its controls instead of jumping to the header.
    var tabs=active&&active.closest('#zoroRequestsHub .rh-tabs');
    if(tabs&&e.key==='ArrowRight'&&active===tabs.lastElementChild){
      var field=doc.querySelector('#zoroRequestsHub .rh-search input');
      if(visible(field)&&field.getBoundingClientRect().left>=active.getBoundingClientRect().right){
        e.preventDefault();e.stopImmediatePropagation();field.focus({preventScroll:true});return;
      }
    }
    var links=Array.from(state.nav.querySelectorAll('a')).concat(Array.from(state.header.querySelectorAll('.zoroHeaderActions button')),search?[search]:[]).filter(function(el){return visible(el)&&!el.disabled;}),index=links.indexOf(active);
    if(index>=0){
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        var next=links[index+(e.key==='ArrowLeft'?-1:1)];e.preventDefault();e.stopImmediatePropagation();if(next)next.focus({preventScroll:true});return;
      }
      if(e.key==='ArrowDown'||e.key==='Escape'||e.keyCode===461||e.keyCode===10009){
        e.preventDefault();e.stopImmediatePropagation();if(visible(state.contentFocus)&&!state.contentFocus.closest('[inert]'))state.contentFocus.focus();else focusContent();return;
      }
    }
    if(e.key!=='ArrowUp'||!active||active.closest('input,textarea,select,[contenteditable],.guide,[role="dialog"],.dialogContainer,.videoPlayerContainer'))return;
    var page=active.closest('.zoroShellPage,#zoroRequestsHub,#slides-container');if(!page)return;
    var box=active.getBoundingClientRect(),above=Array.from(page.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select')).some(function(el){return el!==active&&visible(el)&&!el.closest('[inert]')&&el.getBoundingClientRect().bottom<=box.top+4;});
    if(!above){e.preventDefault();e.stopImmediatePropagation();state.contentFocus=active;(state.nav.querySelector('[aria-current="page"]')||state.nav.querySelector('.zoroNavMain a')).focus({preventScroll:true});}
  }
  function restoreControls() {state.hiddenControls.forEach(function(e){e.classList.remove('zoroShellRelocated');});state.hiddenControls.clear();}
  function headerControls() {
    return Array.from(state.header.querySelectorAll('.headerRight button,.headerRight a[href],.headerRight [role="button"]')).filter(function(e){
      return !e.closest('[hidden],.hide,.zoroHeaderActions')&&!e.matches('.headerSearchButton,[data-action="search"]')&&!/search/i.test(e.getAttribute('aria-label')||e.title||'');
    });
  }
  function controlLabel(e) {var label=e.getAttribute('aria-label')||e.title||e.textContent.trim();if(e.id==='zorofinRequestAlertButton')return 'Notification settings';if(e.id==='yamsSupportBtn')return 'Support';if(/notif/i.test(label))return 'Notifications';return label;}
  function relocateControls() {
    headerControls().forEach(function(e){
      // Unknown, unnamed plugin controls stay visible rather than becoming unreachable.
      if(!controlLabel(e))return;e.classList.add('zoroShellRelocated');state.hiddenControls.add(e);
    });
  }
  function utilityActions(host) {
    if(!host.children.length){
      [['notifications','Notifications'],['support_agent','Support']].forEach(function(item){
        var b=make('button','zoroHomeAction focusable');b.type='button';b.dataset.homeAction=item[1];b.setAttribute('aria-label',item[1]);b.title=item[1];b.appendChild(icon(item[0]));host.appendChild(b);
        b.addEventListener('click',function(){if(b._zoroControl){state.returnFocus=b;b._zoroControl.click();}else if(item[1]==='Notifications')notifications(b);});
      });
    }
    var first=host.querySelector('[data-home-action="'+(tv()?'Support':'Notifications')+'"]');
    if(first&&host.firstElementChild!==first)host.prepend(first);
    var controls=headerControls();
    host.querySelectorAll('button').forEach(function(b){
      b._zoroControl=controls.find(function(c){return controlLabel(c)===b.dataset.homeAction;});
      b.hidden=b.dataset.homeAction==='Support'&&!b._zoroControl;b.disabled=Boolean(b._zoroControl&&b._zoroControl.disabled);
    });
  }
  function headerActions() {
    // Modern owns a React toolbar; Legacy/TV keep their native search control.
    // Proxy existing utilities without moving React-owned elements or handlers.
    var modern=doc.querySelector('header.MuiAppBar-root .MuiToolbar-root a:is([href="#/search"],[href^="#/search?"])');
    var search=modern||state.header.querySelector('.headerSearchButton,[data-action="search"]');
    var host=doc.querySelector('.zoroHeaderActions');
    if(!search){if(host)host.remove();return;}
    if(!host)host=make('div','zoroHeaderActions');
    if(host.parentElement!==search.parentElement)search.before(host);
    utilityActions(host);
  }
  function mobileHeader() {
    var brand=doc.querySelector('.zoroMobileBrand');
    if(wide()||route(root.location.hash)==='search'){if(brand)brand.remove();return;}
    var left=state.header.querySelector('.headerLeft');if(!left)return;
    if(!brand){brand=make('a','zoroMobileBrand focusable');brand.href='#/home';brand.setAttribute('aria-label','Zorofin Home');var logo=make('img');logo.src=window.ZorofinWeb.base+'wordmark.png';logo.alt='Zorofin';brand.appendChild(logo);left.appendChild(brand);}
    else if(brand.parentElement!==left)left.appendChild(brand);
  }
  function homeHeading() {
    doc.querySelectorAll('.zoroHomeHeading').forEach(function(bar){bar.remove();});
  }
  function homeCategories() {
    if(wide()){doc.querySelectorAll('.zoroBrowseCategories').forEach(function(e){e.remove();});return;}
    if(route(root.location.hash)!=='home')return;
    var page=doc.querySelector('.homePage:not(.hide) #homeTab, #indexPage:not(.hide) #homeTab');
    if(!page||new URLSearchParams(root.location.hash.split('?')[1]||'').get('tab')==='1')return;
    var routes=libraries();
    var bar=page.querySelector('.zoroBrowseCategories'),key=JSON.stringify(routes);
    if(bar&&bar.dataset.routes===key)return;
    if(bar)bar.remove();if(!routes.length)return;
    bar=make('nav','zoroBrowseCategories');bar.setAttribute('aria-label','Browse');bar.dataset.routes=key;
    routes.forEach(function(d){var a=make('a','focusable',d.label);a.href=d.href;bar.appendChild(a);});var heading=page.querySelector('.zoroHomeHeading');page.insertBefore(bar,heading?heading.nextSibling:page.firstChild);
  }
  function contextViews() {
    if(route(root.location.hash)!=='browse'){doc.querySelectorAll('.zoroContextToolbar').forEach(function(e){e.parentElement.classList.remove('zoroContextPage');e.remove();});return false;}
    var page=Array.from(doc.querySelectorAll('.mainAnimatedPages .page,.mainAnimatedPages .mainAnimatedPage')).find(visible);
    if(!page)return false;
    var tabs=Array.from(state.header.querySelectorAll('.headerTabs .emby-tab-button')).filter(function(e){return !e.hidden&&!e.classList.contains('hide')&&e.getAttribute('aria-hidden')!=='true';});
    if(!tabs.length)return false;
    var toolbar=page.querySelector('.zoroContextToolbar'),select;
    var library=LIBRARIES.find(function(d){return d.pattern.test(root.location.hash);}),title=library?library.label:page.getAttribute('data-title')||'Browse';
    if(!toolbar){
      toolbar=make('div','zoroContextToolbar');toolbar.appendChild(make('h1','',title));
      select=make('select','zoroContextSelect focusable');select.setAttribute('aria-label',title+' view');
      select.addEventListener('change',function(){var target=select._zoroTabs[Number(select.value)];if(target&&!target.disabled){state.contextFocus=true;target.click();schedule();}});
      toolbar.appendChild(select);page.insertBefore(toolbar,page.firstChild);page.classList.add('zoroContextPage');
    }else select=toolbar.querySelector('select');
    select._zoroTabs=tabs;
    var labels=tabs.map(function(e){var label=e.textContent.trim();return library&&library.key==='livetv'&&label==='Programs'?'On now':label;}),key=JSON.stringify(labels);
    if(select.dataset.options!==key){select.replaceChildren();tabs.forEach(function(tab,i){var option=make('option','',labels[i]);option.value=String(i);option.disabled=tab.disabled;select.appendChild(option);});select.dataset.options=key;}
    var selected=tabs.findIndex(function(e){return e.classList.contains('emby-tab-button-active')||e.getAttribute('aria-selected')==='true';});
    if(selected>=0)select.value=String(selected);
    if(state.contextFocus){state.contextFocus=false;select.focus();}
    return true;
  }
  function decorateSearch() {
    if(route(root.location.hash)!=='search')return;
    var page=doc.querySelector('#searchPage:not(.hide),.searchPage:not(.hide)'),field=page&&page.querySelector('.searchFields');if(!field)return;
    if(!page.querySelector('.zoroSearchHeading'))field.insertBefore(make('h1','zoroSearchHeading','Search'),field.firstChild);
    field.querySelectorAll('input[type="text"],input[type="search"]').forEach(function(input){if(input.getAttribute('aria-label')!=='Search')input.setAttribute('aria-label','Search');});
    // Server categories stay native. External discovery has a dedicated Requests destination.
    if(!page.querySelector('.zoroSearchRequestsLink')){var a=make('a','zoroSearchRequestsLink focusable');a.append(make('span','','Request a title'),icon('arrow_forward'));a.href=DESTINATIONS[2].href;a.addEventListener('click',function(e){if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();var input=field.querySelector('input[data-zorofin-search=true]')||field.querySelector('input[type=search],input[type=text]'),query=(input&&input.value||'').trim().slice(0,256);if(root.ZorofinRequests)root.ZorofinRequests.open(query);else root.location.hash=query?'#/home?zorofin=requests&view=search&query='+encodeURIComponent(query):DESTINATIONS[2].href;});var footer=make('div','zoroSearchFooter');footer.appendChild(a);page.appendChild(footer);}
    var footer=page.querySelector('.zoroSearchFooter');if(footer&&page.lastElementChild!==footer)page.appendChild(footer);
  }
  function loadAccount() {
    if(state.admin===null&&!state.adminPending&&root.ApiClient&&typeof root.ApiClient.getCurrentUser==='function'){
      var key=identity(),userId=root.ApiClient.getCurrentUserId();state.adminPending=true;
      Promise.resolve().then(function(){return root.ApiClient.getCurrentUser();}).then(function(user){
        if(key!==identity())return;state.user=user&&user.Id===userId?user:null;state.admin=Boolean(state.user&&user.Policy&&user.Policy.IsAdministrator);state.adminPending=false;schedule();
      },function(){if(key===identity()){state.admin=false;state.adminPending=false;}});
    }
  }
  function profileIdentity(){
    var link=state.nav&&state.nav.querySelector('.zoroNavProfile a, .zoroNavMain [data-destination="profile"]');if(!link)return;loadAccount();
    var user=state.user,name=user&&user.Name||'',initial=Array.from(name.trim())[0]||'';
    var key=JSON.stringify([name,wide()]);if(link.dataset.account===key)return;link.dataset.account=key;
    link.setAttribute('aria-label',name?name+', profile':'Profile');link.removeAttribute('title');
    var avatar=make('span','zoroProfileAvatar',initial.toUpperCase());avatar.setAttribute('aria-hidden','true');
    if(wide())link.replaceChildren(avatar);else link.replaceChildren(avatar,make('span','','Profile'));
  }
  function profileAdmin(){
    loadAccount();
    if(state.admin){
      if(root.ZorofinApprovalEntry)root.ZorofinApprovalEntry(state.extras);
      else if(!root.ZorofinWeb&&!doc.querySelector('[data-zoro-approvals-script]')){var script=make('script');script.dataset.zoroApprovalsScript='true';script.src='/signup/assets/admin-launch.js';script.onload=function(){if(state.admin&&state.extras)root.ZorofinApprovalEntry(state.extras);};script.onerror=function(){console.warn('Account approvals unavailable');};doc.head.appendChild(script);}
    }
    var link=state.extras.querySelector('[data-zoro-dashboard]'),native=state.extras.parentElement.querySelector('a[href="#/dashboard"]:not([data-zoro-dashboard])');
    // Themes can hide the native Administration section while leaving its link in the DOM.
    if(visible(native)||!state.admin){if(link)link.remove();return;}
    if(!link){link=make('a','zoroProfileShortcut focusable');link.dataset.zoroDashboard='true';link.href='#/dashboard';link.append(icon('dashboard'),make('span','','Dashboard'),icon('chevron_right'));state.extras.insertBefore(link,state.extras.firstChild);}
  }
  function profile() {
    var page=doc.querySelector('#myPreferencesMenuPage:not(.hide)');
    if(route(root.location.hash)!=='profile'||!page)return;
    var host=page.querySelector('.readOnlyContent');if(!host)return;
    if(!host.querySelector('.zoroProfileHeading'))host.insertBefore(make('h1','zoroProfileHeading','Profile'),host.firstChild);
    if(!state.extras||!state.extras.isConnected){state.extras=make('div','zoroProfileShortcuts');host.appendChild(state.extras);}
    var controls=headerControls().filter(function(e){return !e.matches('.headerUserButton,.headerMoonfinButton')&&!/^syncplay$/i.test(controlLabel(e));});
    controls.forEach(function(control){
      var label=controlLabel(control);if(!label)return;
      var existing=Array.from(state.extras.children).find(function(b){return b._zoroControl===control;});if(existing)return;
      var b=make('button','zoroProfileShortcut focusable');b.type='button';b._zoroControl=control;b.append(icon(label==='Support'?'support_agent':label==='Notifications'?'notifications':'tune'),make('span','',label),icon('chevron_right'));
      b.addEventListener('click',function(){state.returnFocus=b;control.click();});state.extras.appendChild(b);
    });
    Array.from(state.extras.children).forEach(function(b){if(b._zoroControl&&!controls.includes(b._zoroControl))b.remove();});
    var nativeNotifications=controls.some(function(e){return controlLabel(e)==='Notifications';}),fallback=state.extras.querySelector('[data-zoro-notifications]');
    if(nativeNotifications&&fallback)fallback.remove();
    if(!nativeNotifications&&!fallback){
      var b=make('button','zoroProfileShortcut focusable');b.type='button';b.dataset.zoroNotifications='true';b.append(icon('notifications'),make('span','','Notifications'),icon('chevron_right'));b.addEventListener('click',function(){notifications(b);});state.extras.appendChild(b);
    }
    profileAdmin();
    // Move the original sign-out control after settings and support; retain its handler.
    var logout=host.querySelector('.btnLogout,#logout,[data-action=logout]');if(logout&&host.lastElementChild!==logout)host.appendChild(logout);
    if(root.ZorofinWatchTogether)root.ZorofinWatchTogether.mount(host);
  }
  function closeNotifications() {
    if(state.controller)state.controller.abort();state.controller=null;
    if(state.notification){state.notification.remove();state.notification=null;}
    if(state.notificationPlace){root.removeEventListener('resize',state.notificationPlace);state.notificationPlace=null;}
    if(state.notificationInert){state.notificationInert.forEach(function(x){x[0].inert=x[1];});state.notificationInert=null;}
    if(state.returnFocus&&visible(state.returnFocus))state.returnFocus.focus();state.returnFocus=null;
  }
  async function notifications(trigger) {
    closeNotifications();state.returnFocus=trigger;
    var backdrop=make('div','zoroNotificationBackdrop'),panel=make('section','zoroNotificationPanel focuscontainer');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Notifications');
    var top=make('div','zoroNotificationTop'),close=make('button','zoroDialogClose focusable');close.type='button';close.setAttribute('aria-label','Close notifications');close.appendChild(icon('close'));close.addEventListener('click',closeNotifications);top.append(make('h2','','Notifications'),close);panel.appendChild(top);
    var content=make('div','zoroNotificationContent');content.setAttribute('aria-live','polite');
    function message(text,symbol){content.replaceChildren();var empty=make('div','zoroNotificationEmpty');empty.append(icon(symbol),make('p','',text));content.appendChild(empty);}
    message('Loading…','notifications_none');panel.appendChild(content);
    // Like the Apple TV app: a panel on the right, hanging from the bell with a small pointer.
    var pointer=make('div','zoroNotificationPointer');pointer.setAttribute('aria-hidden','true');
    backdrop.append(pointer,panel);doc.body.appendChild(backdrop);state.notification=backdrop;
    function place(){
      var vw=doc.documentElement.clientWidth||root.innerWidth,vh=root.innerHeight,big=tv(),gutter=vw<600?12:big?48:24;
      var width=Math.min(big?760:vw<600?420:560,vw-gutter*2),r=trigger&&trigger.isConnected?trigger.getBoundingClientRect():null;
      var anchored=Boolean(r&&r.width&&r.height&&r.bottom>0&&r.bottom<vh*0.4&&r.left<vw&&r.right>0);
      var header=state.header&&state.header.getBoundingClientRect(),top=anchored?r.bottom+14:Math.max(gutter,header?header.bottom+12:gutter);
      // Always on the right edge; the pointer shows only when the bell sits above the panel.
      var left=vw-width-gutter;if(anchored&&(r.left+r.width/2<left+28||r.left+r.width/2>left+width-28))anchored=false;
      backdrop.style.setProperty('--zoro-pop-top',Math.round(top)+'px');backdrop.style.setProperty('--zoro-pop-left',Math.round(left)+'px');
      backdrop.style.setProperty('--zoro-pop-width',Math.round(width)+'px');backdrop.style.setProperty('--zoro-pop-height',Math.round(Math.max(240,Math.min(big?820:650,vh-top-gutter)))+'px');
      pointer.hidden=!anchored;if(anchored)backdrop.style.setProperty('--zoro-pop-pointer',Math.round(Math.min(Math.max(r.left+r.width/2,left+28),left+width-28))+'px');
      panel.style.transformOrigin=Math.round(anchored?r.left+r.width/2-left:width)+'px 0';
    }
    place();state.notificationPlace=place;root.addEventListener('resize',place);
    state.notificationInert=[state.nav,doc.querySelector('.mainAnimatedPages'),state.header].filter(Boolean).map(function(e){var old=e.inert;e.inert=true;return[e,old];});
    close.focus();backdrop.addEventListener('click',function(e){if(e.target===backdrop)closeNotifications();});
    var controller=new AbortController(),key=identity();state.controller=controller;
    var timeout=root.setTimeout(function(){controller.abort();},10000);
    // The server's message (zorofin-server-messages.js) comes first, then support replies.
    // A server without the reference server's support inbox answers 404, which just means no replies.
    var messages=root.ZorofinServerMessages;
    function caughtUp(){
      if(content.querySelector('.zoroNotificationItem'))return;
      var note=content.querySelector('.zoroNotificationNote'),empty=make('div','zoroNotificationCaughtUp');empty.append(make('p','zoroNotificationCaughtUpTitle','You’re all caught up'),make('p','','New updates will appear here.'));
      content.replaceChildren(empty);if(note)content.appendChild(note);
    }
    function kind(symbol,text){var label=make('div','zoroNotificationKind');label.append(icon(symbol),make('span','',text));return label;}
    try {
      var results=await Promise.all([
        messages?messages.current(true).catch(function(){return null;}):null,
        root.fetch('/support/notifications',{headers:{'X-Jellyfin-Token':root.ApiClient.accessToken()},signal:controller.signal,cache:'no-store',redirect:'error'}).then(function(r){
          if(r.status===404)return {notifications:[]};if(!r.ok)throw Error('Notifications are unavailable.');return r.json();
        }).catch(function(){return null;})
      ]);
      if(key!==identity()||state.notification!==backdrop)return;
      var news=results[0],data=results[1];
      if(!data&&!(news&&!news.dismissed))throw Error('Notifications are unavailable.');
      content.replaceChildren();
      if(news&&!news.dismissed){
        var item=make('article','zoroNotificationItem zoroServerMessage'),top=make('div','zoroNotificationItemTop');item.dataset.type=news.type;
        top.appendChild(make('h3','',news.title));item.append(kind(news.type==='maintenance'||news.type==='warning'?'campaign':'auto_awesome','Server message'),top,make('p','',news.message));
        var acts=make('div','zoroNotificationActions');
        if(news.action){var go=make('a','zoroNotificationAction focusable',news.action.label);go.href=news.action.href;if(/^https:/i.test(go.href)){go.target='_blank';go.rel='noopener noreferrer';}go.addEventListener('click',function(){if(!/^https:/i.test(go.href))closeNotifications();});acts.appendChild(go);}
        if(news.dismissible){var done=make('button','zoroNotificationRead focusable');done.type='button';done.append(icon('check'),make('span','','Mark read'));done.addEventListener('click',function(){
          if(key!==identity())return;messages.dismiss(news.id);item.remove();caughtUp();close.focus();
        });acts.appendChild(done);}
        if(acts.children.length)item.appendChild(acts);
        content.appendChild(item);
      }
      var items=data&&Array.isArray(data.notifications)?data.notifications:[];
      items.forEach(function(n){
        var article=make('article','zoroNotificationItem zoroSupportReply'),heading=make('div','zoroNotificationItemTop'),body=make('p','zoroNotificationBody',n.message||'');heading.appendChild(make('h3','',n.affectedMedia||n.issueType||'Support update'));article.append(kind('support_agent','Support reply'),heading,body);
        // Long replies open in place, as on Apple TV.
        if(String(n.message||'').length>160){var more=make('button','zoroNotificationMore focusable','Show more');more.type='button';more.setAttribute('aria-expanded','false');more.addEventListener('click',function(){var open=article.classList.toggle('expanded');more.textContent=open?'Show less':'Show more';more.setAttribute('aria-expanded',String(open));});var moreRow=make('div','zoroNotificationActions');moreRow.appendChild(more);article.appendChild(moreRow);}
        if(/^T[a-z0-9]{6,20}$/i.test(String(n.id||''))){var row=article.querySelector('.zoroNotificationActions')||make('div','zoroNotificationActions'),read=make('button','zoroNotificationRead focusable');article.appendChild(row);read.type='button';read.append(icon('check'),make('span','','Mark read'));read.addEventListener('click',async function(){
          if(key!==identity())return;read.disabled=true;
          try {var res=await root.fetch('/support/notifications/'+encodeURIComponent(n.id)+'/read',{method:'POST',headers:{'X-Jellyfin-Token':root.ApiClient.accessToken()},signal:controller.signal,redirect:'error'});if(!res.ok)throw Error();if(key!==identity())return;article.remove();caughtUp();close.focus();}
          catch(_){if(key===identity()&&article.isConnected){read.disabled=false;read.textContent='Try again';}}
        });row.appendChild(read);}content.appendChild(article);
      });
      if(!data){var note=make('p','zoroNotificationNote','Support updates couldn’t load.');content.appendChild(note);}
      caughtUp();
    }catch(_){if(key===identity()&&state.notification===backdrop){message('Notifications are unavailable.','error_outline');var retry=make('button','zoroNotificationRead focusable','Try again');retry.type='button';retry.addEventListener('click',function(){notifications(trigger);});content.appendChild(retry);}}
    finally{root.clearTimeout(timeout);}
  }
  function measure() {
    if(!state.nav||!state.header)return;
    var phone=root.innerWidth<=599&&!tv(),r=state.header.getBoundingClientRect();
    // Reserve the header's height even when native headroom slides it offscreen.
    // Its animated bottom would otherwise shrink Home underneath the saved scroll anchor.
    var top=Math.max(0,Math.ceil(r.height)),footer=0;
    // Hidden navigation has a zero rectangle. Keep its reservation while dialogs are open.
    if(phone)footer=state.nav.hidden?(parseFloat(html.style.getPropertyValue('--zoro-shell-footer'))||0):Math.ceil(root.innerHeight-state.nav.getBoundingClientRect().top)+12;
    var value=top+'px';if(html.style.getPropertyValue('--zoro-shell-header')!==value)html.style.setProperty('--zoro-shell-header',value);
    value=footer+'px';if(html.style.getPropertyValue('--zoro-shell-footer')!==value)html.style.setProperty('--zoro-shell-footer',value);

  }
  var resizeObserver=typeof root.ResizeObserver==='function'?new root.ResizeObserver(function(){if(api.active)measure();}):null;
  function refresh() {
    state.queued=false;state.passes++;
    if(root.ZorofinWatchTogether)root.ZorofinWatchTogether.sync();
    var who=identity(),current=route(root.location.hash),header=doc.querySelector('.skinHeader');
    // Jellyfin can use pushState for native Search/Back without a hashchange.
    // Let the Requests owner release its overlay, polling and inert page state.
    if(current!=='requests'&&doc.getElementById('zoroRequestsHub')&&root.ZorofinRequests)root.ZorofinRequests.close(root.location.hash);
    if(who!==state.identity){closeNotifications();if(state.extras)state.extras.remove();state.extras=null;state.admin=null;state.adminPending=false;state.user=null;state.libraryLinks=[];state.libraryReady=false;state.libraryPending=false;state.libraryAttempts=0;root.clearTimeout(state.libraryRetry);state.libraryRetry=null;state.identity=who;}
    if(current!==state.route){closeNotifications();state.route=current;}
    var active=Boolean(who&&current&&header),changed=active!==api.active;api.active=active;
    [['zoro-shell-authenticated',Boolean(who)],['zoro-shell-active',active],['zoro-shell-home',active&&(current==='home'||current==='requests')],['zoro-shell-search',active&&current==='search'],['zoro-shell-profile',active&&current==='profile'],['zoro-shell-detail',active&&current==='detail'],['zoro-shell-settings',active&&current==='settings'],['zoro-shell-root',active&&['home','search','requests','profile'].includes(current)]].forEach(function(pair){if(html.classList.contains(pair[0])!==pair[1])html.classList.toggle(pair[0],pair[1]);});
    if(!active){doc.querySelectorAll('.zoroHeaderActions,.zoroHomeHeading,.zoroMobileBrand').forEach(function(e){e.remove();});html.classList.remove('zoro-shell-context-tabs');state.header=null;restoreControls();if(state.nav)state.nav.remove();state.nav=null;closeNotifications();if(resizeObserver)resizeObserver.disconnect();}
    else {
      if(header!==state.header){restoreControls();if(resizeObserver)resizeObserver.disconnect();state.header=header;if(resizeObserver)resizeObserver.observe(header);}
      nav();profileIdentity();relocateControls();headerActions();mobileHeader();homeHeading();homeCategories();decorateSearch();profile();
      doc.querySelectorAll('.mainAnimatedPages .page,.mainAnimatedPages .mainAnimatedPage').forEach(function(page){if(visible(page)&&!page.classList.contains('zoroShellPage'))page.classList.add('zoroShellPage');});
      var hasContext=contextViews();if(html.classList.contains('zoro-shell-context-tabs')!==hasContext)html.classList.toggle('zoro-shell-context-tabs',hasContext);
      var selected=current==='settings'?'profile':current;
      if(current==='browse'){var library=LIBRARIES.find(function(d){return d.pattern.test(root.location.hash);});if(library)selected=library.key;}
      state.nav.querySelectorAll('a').forEach(function(a){if(a.dataset.destination===selected){if(a.getAttribute('aria-current')!=='page')a.setAttribute('aria-current','page');}else if(a.hasAttribute('aria-current'))a.removeAttribute('aria-current');});
      var blocked=Array.from(doc.querySelectorAll('.rh-detail-backdrop,.zoroRecommendationOverlay,#zr-dialog,[role="dialog"][aria-modal="true"]')).some(visible);state.blocked=blocked;state.nav.hidden=blocked;state.nav.inert=blocked;
      if(!blocked&&state.returnFocus&&!state.notification&&visible(state.returnFocus)){state.returnFocus.focus();state.returnFocus=null;}measure();
    }
    if(changed)doc.dispatchEvent(new CustomEvent('zoro:shell-change'));
  }
  function schedule() {if(state.queued||doc.hidden)return;state.queued=true;root.requestAnimationFrame(refresh);}
  // One structural observer; never observe focus classes, animation styles, or each poster's progress.
  var observer=new root.MutationObserver(function(records){
    if(records.some(function(r){return Array.from(r.addedNodes).some(function(n){return n.nodeType===1&&n.matches('.pluginMenuOptions');})||!r.target.closest||!r.target.closest('#zoroGlobalNav,.zoroHeaderActions,.zoroHomeHeading,.zoroBrowseCategories,.zoroProfileShortcuts,.zoroNotificationBackdrop');}))schedule();
  });observer.observe(doc.body,{childList:true,subtree:true});
  // Watch only native tab selection/visibility; remote focus classes do not cause shell work.
  var tabObserver=new root.MutationObserver(function(records){if(records.some(function(r){
    if(!r.target.matches('.headerTabs .emby-tab-button'))return false;
    if(r.attributeName!=='class')return true;
    return ['emby-tab-button-active','hide'].some(function(name){return (r.oldValue||'').split(/\s+/).includes(name)!==r.target.classList.contains(name);});
  }))schedule();});
  tabObserver.observe(doc.body,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['class','hidden','aria-selected','aria-hidden']});
  var layoutObserver=new root.MutationObserver(schedule);layoutObserver.observe(html,{attributes:true,attributeFilter:['class']});
  doc.addEventListener('viewshow',schedule);doc.addEventListener('zoro:requests-view',schedule);doc.addEventListener('visibilitychange',schedule);
  root.addEventListener('hashchange',schedule);root.addEventListener('popstate',schedule);root.addEventListener('resize',schedule);
  root.addEventListener('keydown',function(e){
    if(!state.notification)return;
    if(e.key==='Escape'||e.keyCode===461||e.keyCode===10009){e.preventDefault();e.stopImmediatePropagation();closeNotifications();schedule();return;}
    if(e.key==='Tab'){var list=Array.from(state.notification.querySelectorAll('button:not(:disabled),a[href]')),i=list.indexOf(doc.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();list[list.length-1].focus();}else if(!e.shiftKey&&i===list.length-1){e.preventDefault();list[0].focus();}}
  },true);
  root.addEventListener('keydown',navigationKeys,true);
  api.handleNavigationKey=navigationKeys;
  // Browsing, horizontal scrolling, form input and guide navigation stay native.
  api.diagnostics=function(){return {version:VERSION,passes:state.passes,active:api.active,blocked:state.blocked};};
  schedule();
})(typeof window!=='undefined'?window:null);

/* Native presentation adapter: no fixture rows, copied cards or replacement playback. */
(function(){
  'use strict';
  var theme=window.ZorofinUI||window.ZorofinOwnerTrial;
  if(window.ZorofinNativeTheme||!theme||!theme.active)return;
  window.ZorofinNativeTheme={version:'1.2.2'};
  var doc=document,html=doc.documentElement,queued=false,bannerHome=null,bannerNode=null;
  var bannerObserver=typeof ResizeObserver==='function'?new ResizeObserver(function(){schedule();}):null;
  // Keep the approved Media Bar content and handlers, using still artwork only. An old LG client preference
  // must not suppress its banner with the approved theme. Do not edit
  // the saved preference; rollback retains the client's original behavior.
  var mediaBar;
  function configure(value){
    mediaBar=value;
    if(value&&value.CONFIG)['enableClientSideSettings','enableVideoBackdrop','enableMobileVideo','showTrailerButton','slideAnimationEnabled'].forEach(function(key){Object.defineProperty(value.CONFIG,key,{configurable:true,enumerable:true,get:function(){return false;},set:function(){}});});
  }
  if(window.mediaBarEnhanced)configure(window.mediaBarEnhanced);
  else Object.defineProperty(window,'mediaBarEnhanced',{configurable:true,get:function(){return mediaBar;},set:configure});
  function refresh(){
    queued=false;
    var home=/^#\/home(?:[?]|$)/.test(location.hash)&&!/[?&]zorofin=requests(?:&|$)/.test(location.hash);
    html.classList.toggle('zoro-native-home',home);
    // Servers without the Media Bar plugin (companion pack) never get a banner; don't hold room for one.
    html.classList.toggle('zoro-no-banner',home&&Boolean(window.ZorofinWeb)&&!mediaBar&&!doc.querySelector('#slides-container'));
    var phone=window.innerWidth<=599&&!html.classList.contains('layout-tv')&&!doc.body.classList.contains('layout-tv');
    html.classList.toggle('zoro-mobile-flow',phone);
    var guide=doc.querySelector('.liveTvPage:not(.hide) #guideTab.is-active');
    html.classList.toggle('zoro-native-guide',Boolean(guide));
    // Change labels only once. Preserve option values, inputs and native handlers.
    var support=doc.querySelector('#yamsSupportModal:not([data-zoro-dialog])');
    if(support){
      support.dataset.zoroDialog='true';
      var topic=support.querySelector('label[for="yamsIssueType"] .yamsSupportLabel');if(topic)topic.textContent='Topic';
      var labels={'Playback / buffering problem':'Playback','Live TV issue':'Live TV','Download not appearing / slow':'Downloads','Request a 4K movie upgrade':'4K upgrade','Subtitle or captions problem':'Subtitles','Corrupted video or audio':'Video or audio','Feature request':'Feature request','Other':'Something else'};
      support.querySelectorAll('#yamsIssueType option').forEach(function(option){var value=option.value;if(labels[value]){option.value=value;option.textContent=labels[value];}});
      var send=support.querySelector('#yamsSubmit');if(send&&!send.disabled)send.textContent='Send message';
    }
    var alerts=doc.querySelector('#zorofinRequestAlertModal:not([data-zoro-dialog])');
    if(alerts){
      alerts.dataset.zoroDialog='true';
      var copy={'#zraTitle':'Notification settings','#zraIntro':'Email and phone alerts when your requests are ready.','#zraPushTitle':'Phone notifications','.zraCard[aria-labelledby="zraPushTitle"] .zraCardCopy':'Get private alerts on your phone with ntfy.'};
      Object.keys(copy).forEach(function(selector){var el=alerts.querySelector(selector);if(el)el.textContent=copy[selector];});
      var close=alerts.querySelector('#zraClose');if(close)close.setAttribute('aria-label','Close notification settings');
    }
    var profile=doc.querySelector('#myPreferencesMenuPage:not(.hide) .readOnlyContent');
    if(profile){
      var user=profile.querySelector('.userSection');if(user&&!user.querySelector('.btnLogout'))user.hidden=true;
      var heading=profile.querySelector('.verticalSection .headerUsername');if(heading)heading.dataset.initial=heading.textContent.trim().charAt(0).toUpperCase();
      var account=profile.querySelector('.lnkUserProfile .listItemBodyText');if(account&&account.textContent==='Profile')account.textContent='Account';
      if(!window.ZorofinUI&&window.ZorofinOwnerTrial&&!profile.querySelector('[data-zoro-exit-trial]')){
        var exit=doc.createElement('button');exit.type='button';exit.className='zoroProfileShortcut focusable';exit.dataset.zoroExitTrial='true';exit.textContent='Use current design';exit.addEventListener('click',function(){window.ZorofinOwnerTrial.exit();});
        var logout=profile.querySelector('.btnLogout');profile.insertBefore(exit,logout&&logout.parentElement===profile?logout:null);
      }
    }
    var hero=doc.querySelector('#slides-container');
    if(hero){
      // Media Bar owns this node and reattaches it to body on every route change.
      // Reserve its measured height in Home instead of fighting that observer.
      var homeTab=doc.querySelector('.homePage:not(.hide) #homeTab'),sections=homeTab&&homeTab.querySelector('.homeSectionsContainer');
      var slot=homeTab&&homeTab.querySelector('.zoroMobileHeroSlot');
      if(phone&&home&&sections){
        if(!slot){slot=doc.createElement('div');slot.className='zoroMobileHeroSlot';slot.setAttribute('aria-hidden','true');homeTab.insertBefore(slot,sections);}
        if(bannerObserver&&(bannerHome!==homeTab||bannerNode!==hero)){bannerObserver.disconnect();bannerObserver.observe(homeTab);bannerObserver.observe(hero);bannerHome=homeTab;bannerNode=hero;}
        var height=hero.getBoundingClientRect().height;
        if(height>0&&slot.style.height!==height+'px')slot.style.height=height+'px';
        var top=Math.round((slot.getBoundingClientRect().top+window.scrollY)*100)/100+'px';
        if(html.style.getPropertyValue('--zoro-mobile-banner-top')!==top)html.style.setProperty('--zoro-mobile-banner-top',top);
      }else if(bannerObserver&&bannerHome){bannerObserver.disconnect();bannerHome=null;bannerNode=null;}
      hero.querySelectorAll('.slide').forEach(function(slide){
        var active=slide.classList.contains('active');slide.inert=!active;slide.setAttribute('aria-hidden',String(!active));
        var detail=slide.querySelector('.detail-button'),favorite=slide.querySelector('.favorite-button');
        if(detail&&!detail.hasAttribute('aria-label'))detail.setAttribute('aria-label','More info');
        if(favorite&&!favorite.hasAttribute('aria-label'))favorite.setAttribute('aria-label','My List');
      });
    }
  }
  function schedule(){if(queued||doc.hidden)return;queued=true;requestAnimationFrame(refresh);}
  new MutationObserver(function(records){if(records.some(function(r){return r.type==='childList'||r.target.matches&&r.target.matches('#slides-container .slide,#guideTab,.liveTvPage');}))schedule();}).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);doc.addEventListener('viewshow',schedule);doc.addEventListener('visibilitychange',schedule);schedule();
})();

/* Release Home Screen Sections' pagination scroll lock when leaving Home. */
(function(){
  'use strict';
  if(window.ZorofinHomeScrollCleanup)return;
  window.ZorofinHomeScrollCleanup=true;
  function cleanup(){
    if(/^#\/home(?:\.html)?(?:[?]|$)/i.test(location.hash)&&!/[?&]zorofin=requests(?:&|$)/.test(location.hash))return;
    var meta=window.HssPageMeta;
    if(!meta)return;
    if(meta.ScrollFixerHandle!=null){clearInterval(meta.ScrollFixerHandle);meta.ScrollFixerHandle=undefined;}
    if(meta.ScrollHandler){window.removeEventListener('scroll',meta.ScrollHandler);meta.ScrollHandler=null;}
  }
  window.addEventListener('hashchange',cleanup);
  window.addEventListener('popstate',cleanup);
  document.addEventListener('viewshow',cleanup);
  cleanup();
})();

/* Style and prioritize native sign-in. Never read, store or send credentials. */
(function initialize(root){
  'use strict';if(!root||!root.document||root.ZorofinSignin)return;
  if(!root.document.body){root.document.addEventListener('DOMContentLoaded',function(){initialize(root);},{once:true});return;}
  root.ZorofinSignin={version:'1.2.1'};
  var doc=root.document,state={page:null,queued:false,observer:null,manual:false,quick:null};
  function tv(){return doc.documentElement.classList.contains('layout-tv')||doc.body.classList.contains('layout-tv');}
  function text(tag,cls,value){var e=doc.createElement(tag);e.className=cls;e.textContent=value;return e;}
  function visible(e){return e&&!e.classList.contains('hide')&&!e.hidden;}
  function setClass(e,name,on){if(e.classList.contains(name)!==on)e.classList.toggle(name,on);}
  // Change server: add the brand and a clear heading, mark this server's tile and show each server's address.
  function servers(){
    var page=doc.querySelector('#selectServerPage:not(.hide)');if(!page)return;
    var body=page.firstElementChild;
    if(body&&!body.querySelector('.zoroSigninBrand')){var brand=text('div','zoroSigninBrand',''),image=doc.createElement('img');image.src=window.ZorofinWeb.base+'wordmark.png';image.alt='Zorofin';image.addEventListener('error',function(){brand.textContent='Zorofin';},{once:true});brand.appendChild(image);body.insertBefore(brand,body.firstChild);}
    var heading=page.querySelector('h1.sectionTitle');if(heading&&heading.textContent!=='Choose a server')heading.textContent='Choose a server';
    var add=page.querySelector('.btnAddServer span');if(add&&add.textContent!=='Add a server')add.textContent='Add a server';
    page.querySelectorAll('.servers .card[data-id]').forEach(function(card){
      var image=card.querySelector('.cardImageContainer');if(image&&!image.classList.contains('zoroServerMark')){image.classList.add('zoroServerMark');image.style.setProperty('background-image','url("zorofin/mark-512.png")','important');}
      var url=card.getAttribute('data-url'),label=card.querySelector('.cardText');
      if(url&&label&&!label.querySelector('.zoroServerAddress')){var host='';try{host=new URL(url).host;}catch(_){host=url;}if(host)label.appendChild(text('span','zoroServerAddress',host));}
    });
  }
  function update(){
    state.queued=false;servers();var page=doc.querySelector('#loginPage:not(.hide)');
    if(!page||!/(?:login|selectserver)/i.test(root.location.hash)){if(state.observer)state.observer.disconnect();state.page=null;return;}
    var manual=page.querySelector('.manualLoginForm'),quick=page.querySelector('.btnQuick'),choices=page.querySelector('.readOnlyContent');
    if(!manual||!quick||!choices)return;
    if(page!==state.page){
      if(state.observer)state.observer.disconnect();state.page=page;state.manual=false;
      if(!page.hasAttribute('data-zoro-signin')){
      page.setAttribute('data-zoro-signin','true');page.classList.add('zoroSignin');
      var body=page.firstElementChild,brand=text('div','zoroSigninBrand','Zorofin');body.insertBefore(brand,body.firstChild);
      // Always show the logo: the header logo is often not drawn yet (or hidden after signing out), so fall back to the branded wordmark apply-branding.sh serves.
      var logo=doc.querySelector('.skinHeader .pageTitleWithDefaultLogo img'),image=doc.createElement('img');image.src=logo&&(logo.currentSrc||logo.src)||window.ZorofinWeb.base+'wordmark.png';image.alt='Zorofin';image.addEventListener('error',function(){brand.textContent='Zorofin';},{once:true});brand.replaceChildren(image);
      var intro=text('div','zoroSigninIntro','');intro.appendChild(text('h1','','Welcome back'));body.insertBefore(intro,manual);
      var lead=text('div','zoroSigninQuick','');choices.insertBefore(lead,choices.firstChild);lead.appendChild(quick);
      lead.insertBefore(text('p','zoroSigninHint','Use your phone to connect this TV.'),quick);
      var manualButton=page.querySelector('.btnManual');if(manualButton){manualButton.querySelector('span').textContent='Use username instead';manualButton.addEventListener('click',function(){state.manual=true;schedule();});}
      var cancel=manual.querySelector('.btnCancel');if(cancel)cancel.addEventListener('click',function(){state.manual=false;schedule();});
      quick.addEventListener('click',function(){state.manual=false;});
      var password=manual.querySelector('#txtManualPassword');
      if(password&&!manual.querySelector('.zoroPasswordReveal')){
        var reveal=text('button','zoroPasswordReveal emby-button focusable','');reveal.type='button';reveal.setAttribute('aria-pressed','false');reveal.setAttribute('aria-label','Show password');var eye=text('span','material-icons','visibility');eye.setAttribute('aria-hidden','true');reveal.appendChild(eye);password.closest('.inputContainer').classList.add('zoroPasswordField');
        reveal.addEventListener('click',function(){var show=password.type==='password';password.type=show?'text':'password';reveal.setAttribute('aria-label',show?'Hide password':'Show password');eye.textContent=show?'visibility_off':'visibility';reveal.setAttribute('aria-pressed',String(show));});password.closest('.inputContainer').appendChild(reveal);
      }
      }
      state.observer=new root.MutationObserver(schedule);[page,manual,quick,page.querySelector('.btnManual')].filter(Boolean).forEach(function(e){state.observer.observe(e,{attributes:true,attributeFilter:['class','hidden']});});
    }
    var available=visible(quick),preferred=tv()&&available&&!state.manual,wasPreferred=page.classList.contains('zoroSigninQuickPreferred');
    setClass(page,'zoroSigninQuickPreferred',preferred);
    if(wasPreferred&&!preferred&&state.manual){var username=manual.querySelector('#txtManualName');if(username)username.focus();}
    var heading=page.querySelector('.zoroSigninIntro h1'),headingText=tv()?(preferred?'Connect your TV':'Sign in'):'Welcome back';if(heading&&heading.textContent!==headingText)heading.textContent=headingText;
    if(preferred&&(manual.contains(doc.activeElement)||doc.activeElement===doc.body))quick.focus();setClass(page,'zoroSigninManual',state.manual||!available);
    var lead=page.querySelector('.zoroSigninQuick');if(lead.hidden!==!available)lead.hidden=!available;
    var hint=page.querySelector('.zoroSigninHint'),hintText=tv()?'Use your phone to connect this TV.':'Connect with a signed-in device.';if(hint&&hint.textContent!==hintText)hint.textContent=hintText;
    var label=quick.querySelector('span');if(label&&label.textContent!=='Quick Connect')label.textContent='Quick Connect';
    // Sign-up is the reference server's own service; other servers (the companion pack sets ZorofinWeb) have none.
    if(root.ZorofinWeb){var stale=page.querySelector('.zoroSignupEntry');if(stale)stale.remove();return;}
    var entry=page.querySelector('.zoroSignupEntry');if(!entry){entry=text('p','zoroSignupEntry','');page.firstElementChild.appendChild(entry);}
    if(entry.dataset.tv!==String(tv())){entry.dataset.tv=String(tv());entry.textContent=tv()?'Create an account on your phone: '+root.location.host+'/signup':'New to Zorofin? ';if(!tv()){var link=text('a','focusable','Sign up');link.href='/signup';entry.appendChild(link);}}
    // Native user selection, password recovery, server choice and inputs remain attached.
    // No automatic click: generating a code is an explicit action and native code owns expiry/polling.
  }
  function schedule(){if(state.queued)return;state.queued=true;root.requestAnimationFrame(update);}
  new root.MutationObserver(function(records){if(records.some(function(r){return !r.target.closest||!r.target.closest('#loginPage');}))schedule();}).observe(doc.body,{childList:true,subtree:true});
  root.addEventListener('hashchange',schedule);doc.addEventListener('viewshow',schedule);root.addEventListener('resize',schedule);schedule();
})(typeof window!=='undefined'?window:null);

/* Continued Home discovery. Each account gets an in-memory, demand-loaded feed.
 * Native configured rows finish first; no server settings or preferences change. */
(function (root) {
  'use strict';
  var PAGE = 24;
  function cursor(page, previous, offset) {
    var ids = page.Items.map(function(i){return i.Id;}).join(',');
    var next = offset + page.Items.length;
    return { previous: ids, offset: next, more: Boolean(ids) && ids !== previous &&
      (typeof page.TotalRecordCount === 'number' ? next < page.TotalRecordCount : page.Items.length >= PAGE) };
  }
  function rowKey(title){return String(title||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/^latest (movies|shows)$/,'recently added $1');}
  function lanes(genres) {
    var result = [
      {title:'Highly rated movies',type:'Movie',MinCommunityRating:7},
      {title:'Shows to discover',type:'Series',IsPlayed:false},
      {title:"Movies you haven't watched",type:'Movie',IsPlayed:false,SortBy:'PremiereDate,SortName'}
    ], seen = new Set();
    genres.forEach(function(genre){
      var name=genre.Name;
      if(!name || name.length>80 || name.includes('|') || seen.has(name.toLowerCase()))return;
      seen.add(name.toLowerCase());
      result.push({title:name+' movies',type:'Movie',Genres:name},{title:name+' shows',type:'Series',Genres:name,SortBy:'PremiereDate,SortName'});
    });
    [2020,2010,2000,1990].forEach(function(year){result.push({title:'Movies from the '+year+'s',type:'Movie',Years:Array.from({length:10},function(_,i){return year+i;}).join(',')});});
    result.push({title:'More movies to explore',type:'Movie',SortBy:'SortName'},{title:'More shows to explore',type:'Series',SortBy:'SortName'});
    return result;
  }
  if(typeof module==='object'&&module.exports){module.exports={cursor:cursor,lanes:lanes,rowKey:rowKey};return;}
  if(!root || root.ZorofinBrowseContinuation)return;
  root.ZorofinBrowseContinuation={version:'1.1.0'};
  var doc=root.document, state=null, queued=false, observer=null;
  function identity(){try{var c=root.ApiClient;return c&&c.accessToken()&&c.getCurrentUserId()?[c.serverId(),c.getCurrentUserId(),c.accessToken()].join(':'):'';}catch(_){return '';}}
  function home(){
    if(doc.hidden || !/^#\/home(?:\.html)?(?:\?|$)/.test(location.hash) || /[?&](?:zorofin=requests|tab=[1-9])/.test(location.hash))return null;
    return Array.from(doc.querySelectorAll('.homePage:not(.hide) #homeTab,#indexPage:not(.hide) #homeTab')).find(function(e){return !e.closest('.hide,[hidden]')&&e.getClientRects().length;});
  }
  function valid(s){return s===state && s.key===identity() && Boolean(home());}
  function node(tag,cls,text){var e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function endNative(){
    var meta=root.HssPageMeta,s=state;
    if(meta&&s){
      var maxScroll=Math.max(0,doc.documentElement.scrollHeight-root.innerHeight);
      var atEnd=root.scrollY>=maxScroll-3,page=meta.Page||1;
      // A hidden/empty native page cannot create the extra scroll distance that
      // HSS expects. Retry its own handler once for that page at the actual end.
      if(!meta.IsLoading&&(meta.Finished||atEnd)&&meta.ScrollFixerHandle!=null){clearInterval(meta.ScrollFixerHandle);meta.ScrollFixerHandle=undefined;}
      if(!meta.Finished&&meta.UsePagination!==false&&atEnd){
        if(meta.IsLoading){
          if(s.nativeCheckPage!==page){s.nativeCheckPage=page;s.nativeCheckUntil=Date.now()+12000;}
          if(!s.nativeTimer&&Date.now()<s.nativeCheckUntil)s.nativeTimer=setTimeout(function(){s.nativeTimer=null;if(valid(s))schedule();},100);
        }else if(meta.IsLoading===false&&doc.querySelector('.homeSectionsContainer #hssLoadingIndicator')&&typeof meta.ScrollHandler==='function'&&s.nativeAdvancedPage!==page&&(meta.LastScrollHeight||0)>=maxScroll-3){
          s.nativeAdvancedPage=page;meta.LastScrollHeight=-1;
          var current=meta,handler=meta.ScrollHandler;
          setTimeout(function(){if(valid(s)&&current===root.HssPageMeta&&current.ScrollHandler===handler&&doc.querySelector('.homeSectionsContainer #hssLoadingIndicator'))handler();},0);
        }
      }
    }
    return (!meta && Boolean(doc.querySelector('.homeSectionsContainer .card'))) || Boolean(meta && (meta.UsePagination===false || (meta.Finished&&!meta.IsLoading)));
  }
  function bounded(promise){var timer;return Promise.race([promise,new Promise(function(_,reject){timer=setTimeout(function(){reject(Error('Library request timed out'));},12000);})]).finally(function(){clearTimeout(timer);});}
  function baseQuery(s){return {Recursive:true,UserId:s.client.getCurrentUserId(),Limit:PAGE,Fields:'Genres',EnableUserData:true,EnableTotalRecordCount:true,EnableImages:true,ImageTypeLimit:1,EnableImageTypes:'Primary,Thumb,Backdrop',ExcludeLocationTypes:'Virtual',IsPlaceHolder:false};}
  async function prepare(s){
    var genres=[];
    try {
      var c=s.client;
      var result=await bounded(c.getJSON(c.getUrl('Genres',Object.assign(baseQuery(s),{IncludeItemTypes:'Movie,Series',EnableImages:false,SortBy:'SortName'}))));
      genres=result.Items||[];
    }catch(e){if(e&&(e.status===401||e.status===403))throw e;}
    if(!valid(s))return;
    var existing=new Set(Array.from(doc.querySelectorAll('.homeSectionsContainer .sectionTitle')).map(function(e){return rowKey(e.textContent);}));
    s.lanes=lanes(genres).filter(function(lane){return !existing.has(rowKey(lane.title));});
    // Shuffle once per visit; every lane retains deterministic paging.
    for(var i=s.lanes.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=s.lanes[i];s.lanes[i]=s.lanes[j];s.lanes[j]=t;}
    s.prepared=true;
  }
  function card(item,s){
    var a=node('a','zoroBrowseCard focusable');a.href='#/details?id='+encodeURIComponent(item.Id)+'&serverId='+encodeURIComponent(s.client.serverId());a.dataset.id=item.Id;
    a.setAttribute('aria-label',[item.Name,item.ProductionYear,item.Type==='Series'?'Show':'Movie'].filter(Boolean).join(', '));
    var tags=item.ImageTags||{},type=tags.Thumb?'Thumb':item.BackdropImageTags&&item.BackdropImageTags.length?'Backdrop':'Primary';
    var tag=type==='Backdrop'?item.BackdropImageTags[0]:tags[type],art=node(tag?'img':'span','zoroBrowsePoster');
    if(tag){art.alt='';art.width=480;art.height=270;art.loading='lazy';art.decoding='async';art.src=s.client.getImageUrl(item.Id,{type:type,tag:tag,maxWidth:640,quality:85});}
    var artwork=node('span','zoroBrowseArtwork');artwork.appendChild(art);
    if(Number.isFinite(item.CommunityRating)){var rating=node('span','zoroBrowseRating');rating.append(node('span','','★'),doc.createTextNode(' '+item.CommunityRating.toFixed(1)));rating.setAttribute('aria-label','Rating '+item.CommunityRating.toFixed(1));artwork.appendChild(rating);}
    a.append(artwork,node('strong','zoroBrowseTitle',item.Name),node('span','zoroBrowseMeta',item.ProductionYear||''));
    return a;
  }
  function appendRow(s,lane,items){
    var key=rowKey(lane.title),existing=s.rowMap.get(key);
    if(existing){var ids=new Set(Array.from(existing.querySelectorAll('.zoroBrowseCard')).map(function(e){return e.dataset.id;}));items.forEach(function(item){if(!ids.has(item.Id))existing.querySelector('.zoroBrowseTrack').appendChild(card(item,s));});return false;}
    var row=node('section','zoroBrowseRow verticalSection');var titleBar=node('div','sectionTitleContainer sectionTitleContainer-cards');var heading=node('h2','sectionTitle sectionTitle-cards',lane.title.replace(/\b(movies|shows)$/i,function(s){return s.charAt(0).toUpperCase()+s.slice(1);} ));heading.id='zoroBrowseTitle'+(++s.serial);row.setAttribute('aria-labelledby',heading.id);
    var track=node('div','zoroBrowseTrack focuscontainer-x');items.forEach(function(item){track.appendChild(card(item,s));});
    // Native spatial navigation owns Up/Down/Back; keep horizontal remote focus
    // within this scroll rail, revealing the actual focused card without animation.
    track.addEventListener('keydown',function(e){
      if(!doc.documentElement.classList.contains('layout-tv') || !['ArrowLeft','ArrowRight'].includes(e.key))return;
      var current=e.target.closest('.zoroBrowseCard');if(!current)return;
      var next=e.key==='ArrowLeft'?current.previousElementSibling:current.nextElementSibling;
      if(next){e.preventDefault();e.stopImmediatePropagation();next.focus();}
    });
    track.addEventListener('focusin',function(e){var a=e.target.closest('.zoroBrowseCard');if(a&&doc.documentElement.classList.contains('layout-tv'))a.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});});
    titleBar.appendChild(heading);row.append(titleBar,track);s.rows.appendChild(row);s.rowMap.set(key,row);return true;
  }
  function status(s,message){if(s.status.textContent!==message)s.status.textContent=message;}
  async function load(){
    var s=state;if(!s||s.loading||!valid(s)||!endNative()||s.done)return;
    s.loading=true;s.error=false;s.auto=false;status(s,'Finding more to watch…');s.button.disabled=true;
    var added=0;
    try{
      if(!s.prepared)await prepare(s);
      if(!valid(s))return;
      for(var requests=0;requests<8 && added<2 && s.lanes.length;requests++){
        var lane=s.lanes[0],query=Object.assign(baseQuery(s),{IncludeItemTypes:lane.type,StartIndex:lane.offset||0,SortBy:lane.SortBy||'CommunityRating,SortName',SortOrder:lane.SortBy==='SortName'?'Ascending':'Descending'});
        ['Genres','Years','MinCommunityRating','IsPlayed'].forEach(function(k){if(lane[k]!==undefined)query[k]=lane[k];});
        var page=await bounded(s.client.getItems(s.client.getCurrentUserId(),query));
        if(!valid(s))return;
        if(!page||!Array.isArray(page.Items))throw Error('Missing library page');
        var next=cursor(page,lane.previous,lane.offset||0);s.lanes.shift();
        Object.assign(lane,next);if(next.more)s.lanes.push(lane);
        var blocked=new Set(s.recent.flat());
        var items=page.Items.filter(function(item){if(!item.Id||!item.Name||!['Movie','Series'].includes(item.Type)||blocked.has(item.Id))return false;blocked.add(item.Id);return true;});
        if(items.length){if(appendRow(s,lane,items))added++;s.recent.push(items.map(function(i){return i.Id;}));if(s.recent.length>6)s.recent.shift();}
      }
      s.done=!s.lanes.length;
      status(s,s.done?'You’re all caught up. Explore more in Movies and Shows.':'');
      s.button.textContent='Explore more';
      // Empty pages need an explicit gesture; they must not create a request loop.
      s.auto=added>0;
    }catch(e){if(valid(s)){s.error=true;status(s,'Couldn’t load more titles. Please try again.');s.button.textContent='Try again';}}
    finally{if(s===state){s.loading=false;s.button.disabled=false;s.button.hidden=s.done;}}
  }
  function demand(){var s=state;if(!s||!s.auto||s.error||s.loading||!valid(s)||!endNative())return;s.more.hidden=false;var r=s.more.getBoundingClientRect();if(r.top<innerHeight+280&&r.bottom>0)load();}
  function deduplicate(){
    var seen=new Set();
    doc.querySelectorAll('#homeTab .verticalSection').forEach(function(row){
      var title=row.querySelector('.sectionTitle');if(!title||!row.querySelector('.card,.zoroBrowseCard'))return;
      var key=rowKey(title.textContent),duplicate=seen.has(key);seen.add(key);
      row.classList.toggle('zoroHomeDuplicate',duplicate);
      if(/^latest (movies|shows)$/i.test(title.textContent.trim()))title.textContent=title.textContent.replace(/^latest/i,'Recently Added');
    });
  }
  function remember(s,target){
    var card=target&&target.closest('.zoroBrowseCard');if(!card||!s.host.contains(card))return;
    s.returnCard=card;s.returnTop=card.getBoundingClientRect().top;
  }
  function finishRestore(s){
    if(s.resumeAuto!==undefined){s.auto=s.resumeAuto;s.resumeAuto=undefined;}
    clearTimeout(s.restoreTimer);s.restoreTimer=null;s.restoreEpoch=(s.restoreEpoch||0)+1;s.restoring=false;s.returnCard=null;
    doc.documentElement.classList.remove('zoro-home-restoring');
  }
  function restore(s){
    if(!s.returnCard||!s.returnCard.isConnected)return;
    if(!s.restoring){s.restoring=true;s.restoreDeadline=Date.now()+1400;doc.documentElement.classList.add('zoro-home-restoring');}
    clearTimeout(s.restoreTimer);var epoch=s.restoreEpoch=(s.restoreEpoch||0)+1;
    // The router resets scroll after mounting Home. Wait for a quiet layout frame
    // before revealing the saved anchor, with a bounded fallback for slow plugins.
    s.restoreTimer=setTimeout(function(){
      if(!valid(s)){finishRestore(s);return;}
      var card=s.returnCard,top=s.returnTop;
      if(!card||!card.isConnected){finishRestore(s);return;}
      var started=Date.now(),steady=0;
      if(doc.documentElement.classList.contains('layout-tv'))card.focus({preventScroll:true});
      function settle(){
        if(!s.restoring||epoch!==s.restoreEpoch)return;
        if(!valid(s)){finishRestore(s);return;}
        var delta=card.getBoundingClientRect().top-top;
        if(Math.abs(delta)>1){root.scrollBy({top:delta,left:0,behavior:'instant'});steady=0;}else steady++;
        if(Date.now()>=s.restoreDeadline||(Date.now()-started>=250&&steady>=4)){finishRestore(s);return;}
        requestAnimationFrame(settle);
      }
      requestAnimationFrame(settle);
    },Math.max(0,Math.min(180,s.restoreDeadline-Date.now())));
  }
  function destroy(){if(state){finishRestore(state);clearTimeout(state.nativeTimer);}if(observer)observer.disconnect();observer=null;if(state)state.host.remove();state=null;}
  function sync(){
    queued=false;var key=identity(),page=home();
    if(state&&state.key!==key)destroy();
    if(!key){destroy();return;}
    if(!page){
      if(state&&/^#\/details(?:[?]|$)/.test(location.hash)){if(observer)observer.disconnect();state.paused=true;return;}
      if(doc.hidden)return;destroy();return;
    }
    if(!state){
      var host=node('div','zoroBrowseContinuation');host.id='zoroBrowseContinuation';var rows=node('div','zoroBrowseRows'),more=node('div','zoroBrowseMore'),text=node('p','',''),button=node('button','focusable','Explore more');text.setAttribute('role','status');button.type='button';button.addEventListener('click',load);more.append(text,button);host.append(rows,more);
      state={key:key,client:root.ApiClient,host:host,rows:rows,more:more,status:text,button:button,lanes:[],recent:[],serial:0,rowMap:new Map(),paused:false,prepared:false,loading:false,auto:true,done:false,error:false};
      host.addEventListener('click',function(e){if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey)remember(state,e.target);},true);
      observer=new IntersectionObserver(function(entries){if(entries.some(function(e){return e.isIntersecting;}))demand();},{rootMargin:'280px'});
    }
    var s=state;
    if(s.host.parentElement!==page){page.appendChild(s.host);observer.observe(s.more);}
    if(s.paused){s.paused=false;if(s.returnCard){s.resumeAuto=s.auto;s.auto=false;}observer.observe(s.more);}
    if(s.returnCard)restore(s);
    // Keep native rows first, including delayed plugin rows. No eager fetching.
    if(page.lastElementChild!==s.host)page.appendChild(s.host);
    deduplicate();
    s.more.hidden=!endNative();
    if(endNative())demand();
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(sync);}}
  new MutationObserver(function(records){if(records.some(function(r){return !r.target.closest||!r.target.closest('#zoroBrowseContinuation');}))schedule();}).observe(doc.body,{childList:true,subtree:true});
  ['wheel','touchstart','pointerdown','keydown'].forEach(function(type){root.addEventListener(type,function(){if(state&&state.restoring)finishRestore(state);},{passive:true,capture:true});});
  root.addEventListener('scroll',demand,{passive:true,capture:true});
  root.addEventListener('hashchange',schedule);root.addEventListener('popstate',schedule);root.addEventListener('resize',schedule);doc.addEventListener('viewshow',schedule);doc.addEventListener('visibilitychange',schedule);
  schedule();
})(typeof window!=='undefined'?window:null);

/* Re-measure native TV rails after their cards and responsive theme settle.
 * Jellyfin may initialize a rail with zero height/width and keep a stale center.
 * Use its own reload/toCenter methods; never rewrite transforms or arrow keys. */
(function(){
  'use strict';
  if(window.ZorofinTVPresentation)return;
  window.ZorofinTVPresentation={version:'1.0.0'};
  var rows=new Map(),queued=false;
  var observer=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
  function active(){return document.documentElement.matches('.layout-tv.zoro-shell-active');}
  function refresh(){
    queued=false;
    rows.forEach(function(_,row){if(!row.isConnected||!active()){if(observer)observer.unobserve(row);rows.delete(row);}});
    if(!active())return;
    document.querySelectorAll('.homeSectionsContainer .emby-scroller').forEach(function(row){
      if(!rows.has(row)){rows.set(row,'');if(observer)observer.observe(row);}
      var slider=row.querySelector('.itemsContainer'),card=slider&&slider.querySelector('.card');
      if(!card||!row.clientWidth||!row.clientHeight||!row.scroller||typeof row.scroller.reload!=='function')return;
      var size=[row.clientWidth,row.clientHeight,card.offsetWidth,slider.children.length].join(':');
      if(rows.get(row)===size)return;rows.set(row,size);
      row.scroller.reload();
      var focused=document.activeElement;
      if(focused&&row.contains(focused)&&focused.matches('.card')&&typeof row.toCenter==='function')row.toCenter(focused,true);
    });
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
  new MutationObserver(function(records){
    if(records.some(function(r){return r.target.closest&&r.target.closest('.homeSectionsContainer')||Array.from(r.addedNodes).some(function(n){return n.nodeType===1&&(n.matches('.homeSectionsContainer,.emby-scroller')||n.querySelector('.homeSectionsContainer,.emby-scroller'));});}))schedule();
  }).observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('viewshow',schedule);document.addEventListener('zoro:shell-change',schedule);
  window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);
  schedule();
})();

/* Reconcile Jellyfin 12 Modern's React header with the shared browsing shell. */
(function () {
  'use strict';
  if (window.__zorofinServer12) return;
  window.__zorofinServer12 = true;
  function refresh() {
    // 12.2 Modern owns a React header alongside the hidden legacy header that
    // existing modules inspect. Keep React's Search/Back handlers and supply
    // the same wordmark; the shared shell already supplies Profile/navigation.
    document.querySelectorAll('header.MuiAppBar-root').forEach(function (header) {
      header.classList.add('zoroModernHeader');
      var toolbar = header.querySelector('.MuiToolbar-root');
      if (!toolbar) return;
      var links = toolbar.querySelector(':scope > .MuiStack-root');
      if (links) links.classList.add('zoroModernDuplicate');
      ['MenuIcon', 'GroupsIcon', 'CastIcon', 'CastConnectedIcon', 'PersonIcon'].forEach(function (name) {
        var icon = toolbar.querySelector('[data-testid="' + name + '"]'), button = icon && icon.closest('button');
        if (button) button.classList.add('zoroModernDuplicate');
      });
      var userMenu = toolbar.querySelector('[aria-controls="app-user-menu"]');
      if (userMenu) userMenu.classList.add('zoroModernDuplicate');
      if (!toolbar.querySelector('.zoroModernBrand')) {
        var brand = document.createElement('a'), image = document.createElement('img');
        brand.className = 'zoroModernBrand'; brand.href = '#/home'; brand.setAttribute('aria-label', 'Zorofin Home');
        image.src = window.ZorofinWeb.base+'wordmark.png'; image.alt = 'Zorofin'; brand.appendChild(image); toolbar.prepend(brand);
      }
    });
    document.querySelectorAll('.homeSectionsContainer > div').forEach(function (row) {
      // Native 12.2 wraps some sections without verticalSection. Normalize the
      // wrapper only; never detach native cards or replace their renderers.
      if (!/(?:^|\s)section\d+(?:\s|$)/.test(row.className)) return;
      row.classList.add('verticalSection');
      var heading = row.querySelector('h2');
      if (heading && heading.textContent.trim() === 'Continue Watching') row.classList.add('ContinueWatching');
      if (heading && heading.textContent.trim() === 'My Media') row.classList.add('MyMedia');
    });
  }
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; refresh(); });
  }
  function start() {
    new MutationObserver(schedule).observe(document.body, {childList:true, subtree:true});
    window.addEventListener('hashchange', schedule);
    refresh();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, {once:true});
}());
