/* Current/next program context for native channel details. Playback stays native. */
(function(root){
 'use strict';if(!root || root.zorofinChannelGuideLoaded)return;root.zorofinChannelGuideLoaded=true;
 var doc=root.document,key='',serial=0,pending=false,updated=0,programs=[],panel=null,signature='',timer=null,scheduled=false;
 function identity(){try{var a=root.ApiClient;return a&&a.accessToken()&&a.getCurrentUserId()?a.serverId()+':'+a.getCurrentUserId()+':'+a.accessToken():'';}catch(_){return '';}}
 function active(){
  if(doc.hidden || !/#\/details\?/.test(root.location.hash))return null;
  var id=new URLSearchParams(root.location.hash.split('?')[1]).get('id');
  var pages=doc.querySelectorAll('#itemDetailPage.zoro-live-tv-channel-detail');
  for(var i=pages.length-1;i>=0;i--)if(!pages[i].classList.contains('hide')&&pages[i].getClientRects().length)return {id:id,page:pages[i]};
  return null;
 }
 function node(tag,cls,text){var n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function clear(){if(panel)panel.remove();panel=null;signature='';}
 function title(p){
  if(root.zorofinLiveEventTools)return root.zorofinLiveEventTools.cleanTitle(p);
  // During script startup, prefer an incomplete title to a guessed matchup.
  return String(p.Name||'Scheduled program').replace(/^live\s*:\s*/i,'').replace(/ — .*\s+vs\.?\s+.*/i,'');
 }
 function time(p){return new Date(p).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
 function render(ctx){
  var now=Date.now(),current=programs.filter(function(p){return Date.parse(p.StartDate)<=now&&Date.parse(p.EndDate)>now;})[0];
  var next=programs.filter(function(p){return Date.parse(p.StartDate)>now;})[0];
  var nextSignature=JSON.stringify([ctx.id,current&&current.Id,next&&next.Id,current&&title(current),next&&title(next)]);
  if(!current&&!next){clear();return;}
  if(panel&&panel.isConnected&&panel.closest('#itemDetailPage')===ctx.page&&nextSignature===signature)return;
  clear();panel=node('section','zoroChannelNow');panel.setAttribute('aria-label','Current channel schedule');
  if(current){
   var event=root.zorofinLiveEventTools&&root.zorofinLiveEventTools.eventFor({Id:ctx.id,Name:'',CurrentProgram:current},now);
   panel.appendChild(node('p','zoroChannelEyebrow',event?'LIVE EVENT · ON NOW':'ON NOW'));
   panel.appendChild(node('h2','zoroChannelTitle',title(current)));
   panel.appendChild(node('p','zoroChannelTime',time(current.StartDate)+' – '+time(current.EndDate)));
   var bar=node('span','zoroChannelProgress'),fill=node('span','');fill.style.width=Math.max(0,Math.min(100,(now-Date.parse(current.StartDate))/(Date.parse(current.EndDate)-Date.parse(current.StartDate))*100))+'%';bar.setAttribute('aria-hidden','true');bar.appendChild(fill);panel.appendChild(bar);
  }
  if(next){var upcoming=node('p','zoroChannelNext');upcoming.appendChild(node('strong','','Up next · '+time(next.StartDate)));upcoming.appendChild(doc.createElement('br'));upcoming.appendChild(doc.createTextNode(title(next)));panel.appendChild(upcoming);}
  var ribbon=ctx.page.querySelector('.detailRibbon');if(!ribbon){clear();return;}
  ribbon.insertBefore(panel,ribbon.querySelector('.mainDetailButtons'));signature=nextSignature;
 }
 function refresh(){
  scheduled=false;clearTimeout(timer);timer=null;
  var ctx=active(),who=identity(),current=ctx&&who?who+':'+ctx.id:'';
  if(current!==key){key=current;serial++;pending=false;updated=0;programs=[];clear();}
  if(!key)return;
  render(ctx);var delay=60000;programs.forEach(function(p){var end=Date.parse(p.EndDate)-Date.now();if(end>0)delay=Math.min(delay,end+25);});timer=setTimeout(refresh,delay);
  if(pending||Date.now()-updated<60000)return;
  pending=true;updated=Date.now();var epoch=serial,client=root.ApiClient,now=Date.now();
  client.getLiveTvPrograms({userId:client.getCurrentUserId(),channelIds:[ctx.id],minEndDate:new Date(now).toISOString(),maxStartDate:new Date(now+8*3600000).toISOString(),limit:48,fields:'Overview,Genres'}).then(function(result){
   if(epoch!==serial || identity()+':'+ctx.id!==key || !active())return;
   programs=(result.Items||[]).filter(function(p){return p.ChannelId===ctx.id&&Number.isFinite(Date.parse(p.StartDate))&&Number.isFinite(Date.parse(p.EndDate))&&Date.parse(p.EndDate)-Date.parse(p.StartDate)<=12*3600000&&!/^(?:[a-z]{2,6}\||threadfin:)/i.test(p.Name||'');}).sort(function(a,b){return Date.parse(a.StartDate)-Date.parse(b.StartDate);});
   signature='';render(ctx);
  }).catch(function(){if(epoch===serial){programs=[];clear();}}).then(function(){if(epoch===serial)pending=false;});
 }
 function schedule(){if(scheduled)return;scheduled=true;setTimeout(refresh,100);}
 new root.MutationObserver(schedule).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
 root.addEventListener('hashchange',schedule);root.addEventListener('focus',function(){updated=0;schedule();});doc.addEventListener('visibilitychange',schedule);schedule();
}(typeof window==='undefined'?null:window));
