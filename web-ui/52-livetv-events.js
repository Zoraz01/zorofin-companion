/* Live events on Home. Guide data is untrusted; no channel-to-fixture inference. */
(function (root, factory) {
  'use strict';
  var events = factory();
  if (typeof module === 'object' && module.exports) module.exports = events;
  else { root.zorofinLiveEventTools=events; events.mount(root); }
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  var PRIORITY = {football:0,basketball:1,soccer:2,baseball:3,hockey:4,cricket:5,tennis:6,golf:7,racing:8,combat:9,event:10};
  var LABELS = {football:'Football',basketball:'Basketball',soccer:'Soccer',baseball:'Baseball',hockey:'Hockey',cricket:'Cricket',tennis:'Tennis',golf:'Golf',racing:'Motorsport',combat:'Fight night',event:'Live event'};
  var STUDIO = /\b(sportscenter|sports centre|first take|the herd|jim rome|foxworth|schrager|finebaum|tiki|tierney|sec now|b1g live|mlb (?:now|tonight)|nba today|nfl live|acc pm|matchday live|premier league live|countdown|overreaction|pregame|pre-game|postgame|post-game|highlights?|replays?|rewind|classics?|review|yankeeography|in 60|encore|paid programming|goal zone|mlb central|leadoff|closer|learning center|preview)\b/i;
  var DISCUSSION = /\b(?:discussion and analysis|debate show|news and (?:information|updates)|sports (?:news|stories|topics)|rotating panelists|preview show|studio analysis|highlights of|replay of|rebroadcast|delayed coverage)\b/i;
  function normalized(value) { var text=String(value || '').replace(/[øØ]/g,'o').replace(/[æÆ]/g,'ae').replace(/ß/g,'ss').replace(/[łŁ]/g,'l');if(text.normalize)text=text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');return text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function teams(value) {
    var parts = String(value || '').split(/\s+(?:vs\.?|v\.?|versus|at)\s+/i);
    return parts.length === 2 && parts.every(function (part) { return normalized(part).length > 2 && !/\b(?:[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)|afc (?:east|west|north|south)|nfc (?:east|west|north|south)|\d*news)\b/i.test(part) && !/^\d+(?::\d+)?(?:\s*(?:am|pm))?$/i.test(part.trim()); }) ? parts : null;
  }
  function cleanTitle(program) {
    var title = String(program.Name || '').trim().replace(/^live\s*:\s*/i,''), split = title.split(' — ');
    // This suffix is added by an older enrichment job. A scoreboard alone does
    // not prove which game a channel carries; require both teams in its own EPG.
    if (split.length > 1) {
      var pair = teams(split[split.length-1]), evidence = ' ' + normalized((program.Overview || '') + ' ' + (program.EpisodeTitle || '')) + ' ';
      if (!pair || !pair.slice().sort(function (a,b) { return b.length-a.length; }).every(function (team) {
        var name = ' ' + normalized(team) + ' ', at = evidence.indexOf(name);
        if (at < 0) return false;
        evidence = evidence.slice(0,at) + ' ' + evidence.slice(at+name.length); return true;
      })) split.pop();
    }
    return split.join(' — ');
  }
  function sport(title, genres) {
    var text = title + ' ' + (genres || []).join(' ');
    if (/\b(soccer|premier league|efl championship|english league championship|english championship|uefa|champions league|europa league|conference league|la liga|bundesliga|serie a|mls|nwsl|wsl|women['’]?s super league|fifa|concacaf|copa|ligue 1)\b/i.test(text)) return 'soccer';
    if (/\b(football|nfl|cfl|super bowl)\b/i.test(text)) return 'football';
    if (/\b(basketball|nba|wnba|fiba|euroleague)\b/i.test(text)) return 'basketball';
    if (/\b(baseball|mlb|world series)\b/i.test(text)) return 'baseball';
    if (/\b(hockey|nhl)\b/i.test(text)) return 'hockey';
    if (/\b(cricket|ipl)\b/i.test(text)) return 'cricket';
    if (/\b(tennis|atp|wta|wimbledon|roland garros)\b/i.test(text)) return 'tennis';
    if (/\b(golf|pga|lpga|ryder cup)\b/i.test(text)) return 'golf';
    if (/\b(formula (?:1|one)|f1|nascar|indycar|grand prix|motogp)\b/i.test(text)) return 'racing';
    if (/\b(ufc|boxing|mma|wwe|wrestling)\b/i.test(text)) return 'combat';
    return 'event';
  }
  function eventFor(channel, now) {
    var p = channel.CurrentProgram || {}, start = Date.parse(p.StartDate), end = Date.parse(p.EndDate);
    if (!channel.Id || !p.Name || !Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end-start > 12*3600000) return null;
    var name = cleanTitle(p), base = name.split(' — ')[0], overview = p.Overview || '';
    if (p.IsRepeat || p.IsLive === false || !(/^live\s*:/i.test(p.Name) || p.IsLive === true)) return null;
    if (/^(?:[a-z]{2,6}\||threadfin:)/i.test(base) || /^threadfin:/i.test(overview) || normalized(base) === normalized(channel.Name)) return null;
    if (STUDIO.test(base) || DISCUSSION.test(overview) || /\b(?:news|talk show|documentary)\b/i.test(base)) return null;
    var kind = sport(base, p.Genres), competition = base;
    if (kind === 'event' && !teams(base) && !/\b(olympics?|opening ceremony|closing ceremony|awards|concert|festival|marathon|rugby|volleyball|swimming|cycling|athletics|track and field)\b/i.test(base)) return null;
    // NBA games lead the row; the remaining sport order and soccer-before-CFL rule stay intact.
    var priority = kind === 'basketball' && leagueFor(base+' '+(p.Genres || []).join(' ')) === 'basketball/nba' ? -1 : kind === 'football' && /\b(cfl|canadian football league)\b/i.test(base) ? 2.5 : PRIORITY[kind];
    var parts = name.split(' — '), matchup = parts.length > 1 ? teams(parts[parts.length-1]) : teams(base);
    return {id:channel.Id,programId:p.Id || '',programImages:programImages(channel,p),name:matchup ? matchup.join(' vs ') : name,competition:matchup && parts.length > 1 ? competition : LABELS[kind],kind:kind,priority:priority,start:start,end:end,channel:String(channel.Name || 'Live TV'),number:String(channel.ChannelNumber || ''),favorite:!!(channel.UserData && channel.UserData.IsFavorite),matchup:matchup,context:base,leagueContext:base+' '+(p.Genres || []).join(' '),evidence:(p.Overview || '')+' '+(p.EpisodeTitle || '')};
  }
  // The programme's own guide images, as the Apple apps use them. Jellyfin can
  // copy the channel logo onto the programme; a tag shared with the channel is
  // the logo, not a picture of the event, so it is skipped.
  function programImages(channel, p) {
    if (!p.Id || p.Id === channel.Id) return [];
    var tags = p.ImageTags || {}, own = Object.create(null), images = [];
    Object.keys(channel.ImageTags || {}).forEach(function (k) { own[channel.ImageTags[k]] = true; });
    (channel.BackdropImageTags || []).concat(channel.ParentBackdropImageTags || []).forEach(function (t) { own[t] = true; });
    [['Thumb', tags.Thumb], ['Backdrop', (p.BackdropImageTags || [])[0]], ['Primary', tags.Primary]].forEach(function (pair) {
      var tag = typeof pair[1] === 'string' ? pair[1].trim() : '';
      if (tag && !own[tag] && /^[A-Za-z0-9_-]{1,64}$/.test(tag)) images.push({type: pair[0], tag: tag});
    });
    return images;
  }
  function select(channels, now) {
    var rows = (channels || []).map(function (c) { return eventFor(c,now); }).filter(Boolean);
    rows.sort(function (a,b) { return a.priority-b.priority || Number(b.favorite)-Number(a.favorite) || a.start-b.start || a.channel.localeCompare(b.channel); });
    var seen = Object.create(null);
    return rows.filter(function (event) {
      // Generic competition titles can be different games. Only identical named
      // matchups in the same sport and exact time slot are merged as simulcasts.
      if (!event.matchup) return true;
      var key = event.kind + ':' + normalized(event.name) + ':' + event.start + ':' + event.end;
      if (seen[key]) return false;
      seen[key] = true; return true;
    });
  }
  function legacyArtworkFor(event, manifest) {
    if(!event.matchup || event.matchup.length!==2 || !manifest || manifest.version!==1)return '';
    var key=event.matchup.map(normalized).sort().join('|'), map=manifest.matchups;
    var path=map && Object.prototype.hasOwnProperty.call(map,key) && map[key];
    // No arbitrary guide image URLs, remote hosts, query strings, or executable SVGs.
    return typeof path==='string' && /^\/live-tv-logos\/art\/[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp)$/.test(path) ? path : '';
  }
  function leagueFor(text) {
    text=normalized(text);
    if (/\b(college|ncaa|youth|under \d+|u\d{2}|u \d{2}|cfl|canadian|cricket|wnba|nwsl)\b/.test(text)) return 'unsupported';
    if (/\b(wsl|women(?: s|s)? super league)\b/.test(text)) return 'soccer/eng.w.1';
    if (/\b(women|womens|female)\b/.test(text)) return 'unsupported';
    if (/\b(nfl|super bowl)\b/.test(text)) return 'football/nfl';
    if (/\bnba\b/.test(text)) return 'basketball/nba';
    if (/\bmlb\b/.test(text)) return 'baseball/mlb';
    if (/\bnhl\b/.test(text)) return 'hockey/nhl';
    if (/\bconference league\b/.test(text)) return 'soccer/uefa.europa.conf';
    if (/\beuropa league\b/.test(text)) return 'soccer/uefa.europa';
    if (/\b(champions league|uefa champions)\b/.test(text)) return 'soccer/uefa.champions';
    if (/\b(serie a|italian soccer)\b/.test(text)) return 'soccer/ita.1';
    if (/\b(ligue 1|french soccer)\b/.test(text)) return 'soccer/fra.1';
    if (/\bscottish\b/.test(text)) return 'unsupported';
    if (/\b(premier league|epl)\b/.test(text)) return 'soccer/eng.1';
    if (/\b(efl championship|english league championship|english championship)\b/.test(text)) return 'soccer/eng.2';
    return '';
  }
  function safeArt(path) {
    return typeof path==='string' && /^\/live-tv-logos\/art\/[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp)$/.test(path);
  }
  function artworkDetailsFor(event, manifest) {
    if (!event || !manifest) return null;
    // Retain v1 resolution for the frozen audit; the live loader only accepts v2.
    if (manifest.version===1) {var old=legacyArtworkFor(event,manifest);return old?{image:old,logos:[],kind:'legacy'}:null;}
    if (manifest.version!==2 || !Array.isArray(manifest.events)) return null;
    var league=leagueFor(event.leagueContext || event.context || event.name || '');
    if(league==='unsupported')return null;
    function names(team){return team && Array.isArray(team.aliases) ? team.aliases.map(normalized).filter(function(n){return n.length>=3;}) : [];}
    function matches(value,team){return names(team).indexOf(normalized(value).replace(/^the /,''))>=0;}
    function mentioned(a,b){
      var evidence=' '+normalized(event.evidence || '')+' ';
      return names(a).some(function(first){
        var at=evidence.indexOf(' '+first+' ');if(at<0)return false;
        var rest=evidence.slice(0,at)+' '+evidence.slice(at+first.length+2);
        return names(b).some(function(second){return rest.indexOf(' '+second+' ')>=0;});
      });
    }
    var candidates=manifest.events.filter(function(f){
      if(!f || !f.home || !f.away || f.home.id===f.away.id || !Object.prototype.hasOwnProperty.call(LABELS,f.sport) || (league && league!==f.league))return false;
      // Some event feeds provide just two team names, with no sport/genres.
      // A unique dated pair can establish the sport; a channel name cannot.
      if(f.sport!==event.kind && !(event.kind==='event' && event.matchup && event.matchup.length===2))return false;
      var kickoff=Date.parse(f.start);if(!Number.isFinite(kickoff) || !Number.isFinite(event.start) || Math.abs(kickoff-event.start)>3*3600000)return false;
      if(event.matchup && event.matchup.length===2)return (matches(event.matchup[0],f.away)&&matches(event.matchup[1],f.home)) || (matches(event.matchup[1],f.away)&&matches(event.matchup[0],f.home));
      return mentioned(f.away,f.home) || mentioned(f.home,f.away);
    });
    // A generic or conflicting guide never gets an arbitrarily chosen fixture.
    if(candidates.length!==1)return null;
    var f=candidates[0], image=safeArt(f.image)?f.image:'', logos=Array.isArray(f.logos)&&f.logos.length===2&&f.logos.every(safeArt)?f.logos:[];
    var orderedTeams=[f.away.name,f.home.name];
    if(event.matchup && matches(event.matchup[0],f.home) && matches(event.matchup[1],f.away)){logos=logos.slice().reverse();orderedTeams.reverse();}
    return image || logos.length ? {image:image,logos:logos,kind:image?'event_image':'team_logos',teams:orderedTeams,league:f.league,sport:f.sport} : null;
  }
  function artworkFor(event,manifest){var detail=artworkDetailsFor(event,manifest);return detail ? detail.image : '';}
  // Authored illustrations, never guide HTML or a guessed team/venue image.
  // Keep the last fallback inline so it also works when the image server is down.
  function sportGraphic(kind) {
    var scenes={
      football:'<g opacity=".28"><path d="M54 76h532v208H54zM142 76v208m89-208v208m89-208v208m89-208v208m89-208v208"/><path d="M65 144h510M65 216h510" stroke-dasharray="3 18"/></g><g transform="rotate(-25 320 180)"><path d="M207 180q113-140 226 0-113 140-226 0Z" fill="currentColor" fill-opacity=".12"/><path d="M238 149q-12 31 0 62m164-62q12 31 0 62M282 180h76m-66-13v26m18-29v32m20-32v32m18-29v26"/></g>',
      basketball:'<g opacity=".28"><path d="M54 70h532v220H54zM320 70v220M54 130h78v100H54m532-100h-78v100h78"/><circle cx="320" cy="180" r="44"/><path d="M54 92a105 105 0 0 1 0 176m532-176a105 105 0 0 0 0 176"/></g><circle cx="320" cy="180" r="84" fill="#39271d"/><path d="M236 180h168M320 96v168M263 118q108 62 0 124m114-124q-108 62 0 124"/>',
      soccer:'<g opacity=".28"><path d="M54 70h532v220H54zM320 70v220M54 122h78v116H54m532-116h-78v116h78"/><circle cx="320" cy="180" r="44"/></g><circle cx="320" cy="180" r="82" fill="#163a32"/><path d="m320 146 33 24-13 39h-40l-13-39Z" fill="currentColor" fill-opacity=".2"/><path d="M320 146v-48m33 72 44-18m-57 57 27 38m-67-38-27 38m14-77-44-18M262 122l58-12 58 12m22 60-25 58-55 23-55-23-25-58"/>',
      baseball:'<g opacity=".28"><path d="m320 62 170 118-170 118-170-118Z"/><path d="M150 180Q150 40 320 42q170-2 170 138M300 275h40v22h-40z"/></g><circle cx="320" cy="176" r="79" fill="#3d2a22"/><path d="M271 114q67 62 0 124m98-124q-67 62 0 124"/><path d="m277 130 16-6m-1 29 17-5m-12 29h18m-22 23 17 6m-32 17 16 7m63-91-16-6m1 29-17-5m12 29h-18m22 23-17 6m32 17-16 7" stroke-width="3"/>',
      hockey:'<g opacity=".28"><rect x="54" y="70" width="532" height="220" rx="70"/><path d="M235 70v220m85-220v220m85-220v220"/><circle cx="320" cy="180" r="40"/><circle cx="160" cy="132" r="24"/><circle cx="480" cy="228" r="24"/></g><path d="m393 92-88 138q-8 15-26 15h-80v-25h80l89-141" fill="#203847"/><ellipse cx="366" cy="254" rx="38" ry="12" fill="#203847"/><path d="M328 254v13c0 17 76 17 76 0v-13"/>',
      cricket:'<g opacity=".28"><ellipse cx="320" cy="180" rx="246" ry="115"/><path d="M272 88h96v184h-96z"/></g><path d="m314 100 23 12-68 135q-5 11-18 4l-13-7q-9-5-3-16Z" fill="#343520"/><path d="m322 104 26-48 12 7-26 48m39 27v108m18-108v108m18-108v108m-43-115h50"/><circle cx="343" cy="250" r="25" fill="#343520"/><path d="m331 228q26 22 14 46" stroke-dasharray="3 5"/>',
      tennis:'<g opacity=".28"><path d="M78 70h484v220H78zM126 70v220m388-220v220M126 125h388M126 235h388M320 125v110M78 180h484"/></g><g transform="rotate(32 320 180)"><ellipse cx="312" cy="151" rx="52" ry="66" fill="#263c23"/><path d="M284 99v105m19-118v130m19-129v128m19-115v103M265 128h94m-99 23h104m-100 23h96M288 210l14 45h21l14-45m-35 45v40h21v-40"/><path d="M302 272h21"/></g><circle cx="410" cy="239" r="25" fill="#263c23"/><path d="M392 222q25 8 32 34"/>',
      golf:'<g opacity=".28"><path d="M65 265q50-112 149-67t194-18q108-74 168 22M72 290q100-61 204-16t292-31"/></g><ellipse cx="328" cy="248" rx="141" ry="42" fill="currentColor" fill-opacity=".08"/><ellipse cx="329" cy="247" rx="18" ry="6"/><path d="M329 246V72l85 30-85 30"/><path d="m333 78 67 24-67 24" fill="currentColor" fill-opacity=".23" stroke="none"/><circle cx="244" cy="252" r="13" fill="currentColor" fill-opacity=".55"/>',
      racing:'<g opacity=".28"><path d="M48 275 225 73h202l165 202M116 275 266 101h118l141 174"/><path d="m319 108-2 169" stroke-dasharray="18 18"/></g><path d="M270 277V90q53-32 105 0v100q-52-32-105 0" fill="#352c49"/><path d="M270 90q53-32 105 0v100q-52-32-105 0Z"/><path d="M296 78v100m27-106v100m26-94v100M270 123q53-32 105 0m-105 33q53-32 105 0"/><path d="M270 90q13-8 26-12v33q-13 4-26 12Zm53-18q13 0 26 6v33q-13-6-26-6Zm-27 72q13-5 27-5v33q-14 0-27 6Zm53 0q13 5 26 12v34q-13-8-26-12Z" fill="currentColor" fill-opacity=".4" stroke="none"/>',
      combat:'<g opacity=".28"><path d="m187 67-85 66v94l85 66h266l85-66v-94l-85-66Zm12 23-72 55v70l72 55h242l72-55v-70l-72-55Z"/></g><path d="M265 220q-30-20-30-55v-30q0-42 43-42h34q29 0 29 30v38l15-20q12-14 24-3 11 10 0 27l-42 65v36h-73Z" fill="#432630"/><path d="M265 230h73m-73 20h73m-79-111v38m29-57v45m28-39v43"/>',
      event:'<g opacity=".28"><path d="M126 123q-40 57 0 114m-31-143q-60 86 0 172m419-143q40 57 0 114m31-143q60 86 0 172"/></g><rect x="195" y="98" width="250" height="164" rx="24" fill="#243342"/><path d="m301 144 59 36-59 36Z" fill="currentColor" fill-opacity=".2"/>'
    };
    var scene=Object.prototype.hasOwnProperty.call(scenes,kind)?scenes[kind]:scenes.event;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">'+scene+'</g></svg>';
  }
  // Same order as the iOS and Apple TV apps: the verified fixture image, the
  // programme's own guide image, team crests, then the sport's illustration.
  // No stock photos: an illustration reads better than a generic stadium shot.
  function artworkChoices(event,detail) {
    var choices=[];
    if(detail && detail.image)choices.push({kind:'event_image',image:detail.image});
    if(event.programId)(event.programImages || []).forEach(function(image){choices.push({kind:'program_image',item:event.programId,type:image.type,tag:image.tag});});
    if(detail && detail.logos.length===2)choices.push({kind:'team_logos',logos:detail.logos});
    choices.push({kind:'sport_graphic',sport:detail && detail.sport || event.kind});
    return choices;
  }
  function programImageUrl(choice) {
    var api=window.ApiClient, query={type:choice.type,tag:choice.tag,maxWidth:720,quality:85};
    if(api && api.getImageUrl)return api.getImageUrl(choice.item,query);
    return '/Items/'+encodeURIComponent(choice.item)+'/Images/'+choice.type+'?tag='+encodeURIComponent(choice.tag)+'&maxWidth=720&quality=85';
  }
  function logo(name) {
    var clean = normalized(name).replace(/\s+(?:hd|4k)$/,'');
    var map = {'espn':'espn-us','espn 2':'espn-2-us','espn u':'espn-u-us','espn news':'espnews-us','fox sports 1':'fox-sports-1-us','fox sports 2':'fox-sports-2-us','fox soccer plus':'fox-soccer-plus-us','cbs sports network':'cbs-sports-network-us','cbs sports golazo network':'cbs-sports-golazo-network-us','willow cricket':'willow-us','tnt':'tnt-us','nba tv':'nba-tv-us','nfl network':'nfl-network-us','sec network':'sec-network-us','bein sports':'bein-sports-us','bein sports 2':'bein-sports-2-us','bein sports xtra':'bein-sports-xtra-us'};
    return map[clean] ? '/live-tv-logos/real/' + map[clean] + '.png' : '';
  }
  function mount(window) {
    if (!window || window.zorofinLiveEventsLoaded) return;
    window.zorofinLiveEventsLoaded = true;
    var document = window.document, ID = 'zoroLiveEvents', TTL = 60000;
    var artwork=null, artUpdated=0, artPending=false, ART_TTL=300000;
    var identity = '', generation = 0, channels = [], updated = 0, success = 0, failed = false, pending = false, scheduled = false, timer = null, row = null, signature = '';
    function clientIdentity() {
      try { var api=window.ApiClient; return api && api.accessToken() && api.getCurrentUserId() ? api.serverId()+':'+api.getCurrentUserId()+':'+api.accessToken() : ''; } catch (_) { return ''; }
    }
    function homeHost() {
      // Reuse this exact event/artwork pipeline for Live TV's
      // curated view. Guide and Channels keep their native content and handlers.
      if(document.hidden)return null;
      if((window.ZorofinUI && window.ZorofinUI.active || window.ZorofinOwnerTrial && window.ZorofinOwnerTrial.active) && /^#\/livetv(?:[?]|$)/.test(window.location.hash)){
        var live=document.querySelector('#liveTvSuggestedPage:not(.hide) #suggestionsTab.is-active');
        if(!live || !live.getClientRects().length)return null;
        var host=live.querySelector('#zoroLiveNowHost');
        if(!host){host=node('div');host.id='zoroLiveNowHost';live.appendChild(host);live.classList.add('zoro-live-curated');}
        return host;
      }
      if(/[?&]zorofin=requests(?:&|$)/.test(window.location.hash))return null;
      if (document.hidden || !/(?:^|[\/#])home(?:\.html)?(?:[?&]|$)/i.test(window.location.hash) || /[?&]tab=(?!0(?:&|$))\d+/i.test(window.location.hash)) return null;
      var pages=document.querySelectorAll('.homePage,#indexPage,#homePage');
      for(var i=0;i<pages.length;i++) {
        if(pages[i].classList.contains('hide') || !pages[i].getClientRects().length) continue;
        var tab=pages[i].querySelector('#homeTab');
        if(tab && !tab.classList.contains('hide') && tab.getClientRects().length) return tab.querySelector('.sections');
      }
      return null;
    }
    // Catalogue paths start /live-tv-logos/art/. The reference server serves them under /web/zorofin;
    // the companion's web look serves them next to its own files.
    function artSrc(path) { return window.ZorofinWeb && window.ZorofinWeb.base ? window.ZorofinWeb.base+path.slice(1) : '/web/zorofin'+path; }
    function node(tag, cls, text) { var el=document.createElement(tag); if(cls) el.className=cls; if(text!==undefined) el.textContent=text; return el; }
    function clear() { if(row) row.remove(); row=null;signature=''; }
    function details(id) { return '#/details?id='+encodeURIComponent(id)+'&serverId='+encodeURIComponent(window.ApiClient.serverId()); }
    function time(value) { return new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}); }
    function loadArtwork() {
      // On the companion's web look the catalogue exists only when the operator turned on sports
      // artwork (the companion marks the page). Otherwise cards use guide images and illustrations.
      if(window.ZorofinWeb && !window.ZorofinWeb.liveArtwork && !document.documentElement.classList.contains('zorofin-sports-art'))return;
      if(artPending || Date.now()-artUpdated<ART_TTL || !select(channels,Date.now()).length)return;
      artPending=true;artUpdated=Date.now();
      var controller=window.AbortController ? new window.AbortController() : null, timeout;
      var deadline=new Promise(function(_,reject){timeout=setTimeout(function(){if(controller)controller.abort();reject(new Error('artwork timeout'));},4000);});
      // Jellyfin's static route works on direct LAN connections and behind the proxy.
      var request=Promise.resolve().then(function(){return window.fetch(window.ZorofinWeb.base+'live-tv-logos/art/events.json?v='+Math.floor(Date.now()/ART_TTL),{credentials:'omit',signal:controller ? controller.signal : undefined});}).then(function(response){if(!response.ok)throw new Error('artwork unavailable');return response.json();});
      Promise.race([request,deadline]).then(function(result){
        if(result && result.version===2 && Array.isArray(result.events))artwork=result;
      }).catch(function(){}).then(function(){clearTimeout(timeout);artPending=false;if(homeHost() && identity===clientIdentity())render();});
    }
    function styles() {
      if(document.getElementById(ID+'Styles')) return;
      var el=node('style');el.id=ID+'Styles';
      el.textContent=[
        // Same look as the iOS and Apple TV "Sports & live events" shelf and
        // the other Home rows: bare 16:9 artwork with a LIVE pill, then title,
        // channel, time and a thin progress line. No card box, no sub-headings.
        '#zoroLiveEvents{margin:16px 0 24px;contain:layout style;color:#f5f7f5}',
        '#zoroLiveEvents .zle-heading{display:flex;align-items:center;flex-wrap:wrap;gap:0 16px;margin:0;padding:0 var(--zoro-home-gutter,3.3%)}',
        '#zoroLiveEvents h2{margin:0;font-size:24px;font-weight:650;line-height:1.25}',
        '#zoroLiveEvents h2:before{content:"";display:inline-block;width:3px;height:.82em;margin-right:.48em;border-radius:999px;background:var(--zoro-ui-accent-strong,#25b85f);vertical-align:-.04em}',
        '#zoroLiveEvents .zle-heading-link{display:inline-flex;align-items:center;min-height:48px;color:inherit;text-decoration:none;border-radius:4px}',
        '#zoroLiveEvents .zle-all{display:inline-flex;align-items:center;gap:6px;min-height:48px;font-size:15px;font-weight:600;color:var(--zoro-ui-accent-strong,#25b85f);text-decoration:none;white-space:nowrap;border-radius:4px}',
        '#zoroLiveEvents .zle-track{display:flex;gap:var(--zoro-home-gap,20px);overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:20px var(--zoro-home-gutter,3.3%);scroll-padding-inline:var(--zoro-home-gutter,3.3%)}',
        '#zoroLiveEvents .zle-track::-webkit-scrollbar{display:none}',
        '#zoroLiveEvents .zle-card{display:flex;flex-direction:column;flex:0 0 var(--zoro-home-art,clamp(240px,23vw,400px));min-width:0;text-decoration:none;color:inherit;outline:none}',
        '#zoroLiveEvents .zle-art{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#151c18;border:1px solid var(--zoro-ui-border,#ffffff2e);box-sizing:border-box}',
        '#zoroLiveEvents .zle-media{position:absolute;inset:0;overflow:hidden}',
        '#zoroLiveEvents .zle-team-logos{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-evenly;padding:16px 14px 0;box-sizing:border-box;background:linear-gradient(135deg,#213f36,#0e201a)}',
        '#zoroLiveEvents .zle-team-logos img{width:34%;height:72%;object-fit:contain}',
        '#zoroLiveEvents .zle-team-logos span{font-size:14px;font-weight:700;color:#bce2c8}',
        '#zoroLiveEvents .zle-event-image{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain}',
        '#zoroLiveEvents .zle-sport-graphic{position:absolute;inset:0;color:#b8cfe0;background:linear-gradient(135deg,#263c50,#111a24)}',
        '#zoroLiveEvents .zle-sport-graphic svg{display:block;width:100%;height:100%}',
        '#zoroLiveEvents [data-sport=soccer] .zle-sport-graphic,#zoroLiveEvents [data-sport=golf] .zle-sport-graphic{color:#a8d9c4;background:linear-gradient(135deg,#21483e,#122820)}',
        '#zoroLiveEvents [data-sport=basketball] .zle-sport-graphic,#zoroLiveEvents [data-sport=baseball] .zle-sport-graphic{color:#e1b890;background:linear-gradient(135deg,#503727,#271d18)}',
        '#zoroLiveEvents [data-sport=cricket] .zle-sport-graphic,#zoroLiveEvents [data-sport=tennis] .zle-sport-graphic{color:#cadb9d;background:linear-gradient(135deg,#3d4726,#202719)}',
        '#zoroLiveEvents [data-sport=racing] .zle-sport-graphic{color:#cebbeb;background:linear-gradient(135deg,#403252,#221b30)}',
        '#zoroLiveEvents [data-sport=combat] .zle-sport-graphic{color:#e8b8bd;background:linear-gradient(135deg,#512c38,#2b1b24)}',
        '#zoroLiveEvents .zle-top{position:absolute;top:10px;left:10px;right:10px;z-index:1;display:flex;pointer-events:none}',
        '#zoroLiveEvents .zle-live{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;background:#000000bf;color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}',
        '#zoroLiveEvents .zle-live:before{content:"";width:7px;height:7px;border-radius:50%;background:#ff453a}',
        '#zoroLiveEvents .zle-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-top:10px;font-size:var(--zoro-home-title,18px);font-weight:600;line-height:1.3;overflow-wrap:anywhere}',
        '#zoroLiveEvents .zle-channel{display:block;margin-top:4px;font-size:var(--zoro-home-meta,15px);line-height:1.3;color:#bbc5bd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#zoroLiveEvents .zle-time{display:block;margin-top:2px;font-size:calc(var(--zoro-home-meta,15px) - 1px);line-height:1.3;color:#bbc5bd}',
        '#zoroLiveEvents .zle-progress{height:3px;margin-top:8px;border-radius:999px;background:var(--zoro-ui-border,#ffffff2e);overflow:hidden}#zoroLiveEvents .zle-progress span{display:block;height:100%;border-radius:999px;background:var(--zoro-ui-accent-strong,#25b85f)}',
        '#zoroLiveEvents a:focus-visible{outline:3px solid #fff;outline-offset:4px}',
        '#zoroLiveEvents .zle-card:focus-visible{outline:none}#zoroLiveEvents .zle-card:focus-visible .zle-art{outline:3px solid #f5f7f5;outline-offset:4px}',
        '@media(hover:hover){#zoroLiveEvents .zle-card:hover .zle-art{border-color:#ffffff66}}',
        '@media(max-width:599px){#zoroLiveEvents .zle-card{flex-basis:var(--zoro-home-art,240px)}#zoroLiveEvents .zle-heading{padding-inline:var(--zoro-home-gutter,4%)}#zoroLiveEvents h2{font-size:20px}#zoroLiveEvents .zle-all{font-size:14px}#zoroLiveEvents .zle-track{padding:14px var(--zoro-home-gutter,4%);gap:var(--zoro-home-gap,12px)}}',
        '.layout-tv #zoroLiveEvents h2{font-size:clamp(26px,1.5625vw,60px);font-weight:700}.layout-tv #zoroLiveEvents .zle-all,.layout-tv #zoroLiveEvents .zle-heading-link{min-height:60px}.layout-tv #zoroLiveEvents .zle-track{padding-block:24px}.layout-tv #zoroLiveEvents .zle-art{border-radius:var(--zoro-tv-radius,12px)}',
        '@media(prefers-reduced-motion:reduce){#zoroLiveEvents *{scroll-behavior:auto!important}}'
      ].join('');document.head.appendChild(el);
    }
    function render() {
      var host=homeHost(), now=Date.now();
      if(!host || !identity || identity!==clientIdentity()) {clear();return [];}
      var events=now-success<2*TTL ? select(channels,now) : [];
      if(!events.length){
        clear();
        if(host.id==='zoroLiveNowHost'){
          var text=failed?'Live events are unavailable.':success?'No featured events live right now.':'Loading live events…',empty=host.querySelector('.zoroLiveEmpty');
          if(!empty){empty=node('div','zoroLiveEmpty');empty.appendChild(node('p'));var guide=node('a','zoroSearchRequestsLink focusable','Open guide');guide.href='#/livetv?tab=1';empty.appendChild(guide);host.appendChild(empty);}
          if(empty.firstChild.textContent!==text)empty.firstChild.textContent=text;
        }
        return events;
      }
      var empty=host.querySelector('.zoroLiveEmpty');if(empty)empty.remove();
      events.forEach(function(event){event.artwork=artworkDetailsFor(event,artwork);if(event.artwork && event.artwork.sport && event.kind==='event'){event.kind=event.artwork.sport;event.competition=LABELS[event.kind];}if(event.artwork && event.artwork.teams && !event.matchup){event.name=event.artwork.teams.join(' vs ');event.competition=event.context;}});
      var next=JSON.stringify(events);
      if(row && row.parentNode===host && signature===next) {
        events.forEach(function(e,i){row.querySelectorAll('.zle-progress span')[i].style.width=Math.min(100,100*(now-e.start)/(e.end-e.start))+'%';});
        return events;
      }
      var active=document.activeElement, focused=row && row.contains(active), focusId=focused && active.getAttribute('data-channel-id'), allFocused=focused && active.classList.contains('zle-all'), titleFocused=focused && active.classList.contains('zle-heading-link');
      var offset=row ? row.querySelector('.zle-track').scrollLeft : 0;
      // Keep the positioned section attached while refreshing its cards. Removing
      // it loses Home's flex order and lets scroll anchoring jump into another row
      // before the layout observer can move the replacement back into place.
      if(row && row.parentNode===host){while(row.firstChild)row.removeChild(row.firstChild);}
      else {clear();row=node('section','verticalSection');row.id=ID;row.setAttribute('aria-labelledby',ID+'Title');}
      styles();
      var heading=node('div','zle-heading'), title=node('h2','sectionTitle'), titleLink=node('a','zle-heading-link',host.id==='zoroLiveNowHost'?'Live now':'Sports & live events');title.id=ID+'Title';
      titleLink.href='#/livetv?collectionType=livetv';title.appendChild(titleLink);heading.appendChild(title);
      var all=node('a','zle-all','All channels');all.href=host.id==='zoroLiveNowHost'?'#/livetv?tab=2':titleLink.href;
      var chevron=node('span','','›');chevron.setAttribute('aria-hidden','true');all.appendChild(chevron);heading.appendChild(all);row.appendChild(heading);
      var track=node('div','zle-track');
      events.forEach(function(e){
        var link=node('a','zle-card');link.href=details(e.id);link.setAttribute('data-channel-id',e.id);
        link.setAttribute('aria-label',e.name+', live on '+e.channel+', '+time(e.start)+' to '+time(e.end)+'. Open channel.');
        var art=node('div','zle-art');art.setAttribute('data-sport',e.kind);
        var top=node('div','zle-top');top.appendChild(node('span','zle-live','Live'));art.appendChild(top);
        var media=node('div','zle-media'),choices=artworkChoices(e,e.artwork),choiceIndex=0;
        function showArtwork(){
          var choice=choices[choiceIndex++],attempt=choiceIndex;
          while(media.firstChild)media.removeChild(media.firstChild);
          if(!choice)return;
          function imageFailed(){if(attempt===choiceIndex)showArtwork();}
          art.setAttribute('data-art-kind',choice.kind);
          if(choice.image || choice.kind==='program_image'){
            var photo=node('img','zle-event-image');photo.alt='';photo.loading='lazy';photo.decoding='async';photo.width=1280;photo.height=720;
            photo.addEventListener('error',imageFailed,{once:true});photo.src=choice.image?artSrc(choice.image):programImageUrl(choice);media.appendChild(photo);
          }else if(choice.kind==='team_logos'){
            var pair=node('div','zle-team-logos');
            choice.logos.forEach(function(path,i){
              if(i)pair.appendChild(node('span','','VS'));
              var badge=node('img');badge.alt='';badge.loading='lazy';badge.decoding='async';badge.addEventListener('error',imageFailed,{once:true});badge.src=artSrc(path);pair.appendChild(badge);
            });media.appendChild(pair);
          }else{
            var graphic=node('div','zle-sport-graphic');graphic.setAttribute('aria-hidden','true');
            // The markup is exclusively the static allowlisted scenes above.
            graphic.innerHTML=sportGraphic(choice.sport);media.appendChild(graphic);
          }
        }
        art.classList.add('zle-has-art');art.appendChild(media);showArtwork();
        link.appendChild(art);
        link.appendChild(node('span','zle-title',e.name));
        link.appendChild(node('span','zle-channel',e.channel+(e.number?' · Ch '+e.number:'')));
        link.appendChild(node('span','zle-time',time(e.start)+' – '+time(e.end)));
        var progress=node('div','zle-progress');progress.setAttribute('aria-hidden','true');var fill=node('span');fill.style.width=Math.min(100,100*(now-e.start)/(e.end-e.start))+'%';progress.appendChild(fill);link.appendChild(progress);
        link.addEventListener('click',function(event){
          if(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
          // Never send a viewer to yesterday's game or an earlier account's card.
          if(clientIdentity()!==identity || Date.now()>=e.end || Date.now()-success>=2*TTL){event.preventDefault();event.stopImmediatePropagation();refresh(true);}
        },true);track.appendChild(link);
      });
      track.addEventListener('keydown',function(event){
        if(event.key!=='ArrowLeft' && event.key!=='ArrowRight')return;
        var cards=Array.prototype.slice.call(track.querySelectorAll('a')),at=cards.indexOf(document.activeElement),next=at+(event.key==='ArrowRight'?1:-1);
        if(at<0 || next<0 || next>=cards.length)return;
        event.preventDefault();event.stopPropagation();cards[next].focus();cards[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
      });
      row.appendChild(track);
      // The shared Home layout places current events after the first two rows.
      if(row.parentNode!==host)host.appendChild(row);signature=next;track.scrollLeft=offset;
      if(focused){var replacement=all;Array.prototype.forEach.call(track.children,function(c){if(c.getAttribute('data-channel-id')===focusId)replacement=c;});if(allFocused)replacement=all;if(titleFocused)replacement=titleLink;replacement.focus({preventScroll:true});}
      return events;
    }
    function refresh(force) {
      var current=clientIdentity();
      if(current!==identity){identity=current;generation++;channels=[];pending=false;updated=0;success=0;failed=false;clear();}
      clearTimeout(timer);timer=null;
      if(!identity || !homeHost()){clear();return;}
      loadArtwork();
      var events=render(), soon=TTL;
      events.forEach(function(e){soon=Math.min(soon,Math.max(1000,e.end-Date.now()+20));});
      timer=setTimeout(function(){refresh(false);},soon);
      if(pending || (!force && Date.now()-updated<TTL))return;
      pending=true;failed=false;updated=Date.now();
      var epoch=generation, source=identity, api=window.ApiClient, user=api.getCurrentUserId(), all=[];
      function page(){
        return api.getLiveTvChannels({userId:user,addCurrentProgram:true,fields:'Overview,Genres,Tags',enableUserData:true,enableImages:true,imageTypeLimit:1,enableImageTypes:'Primary,Thumb,Backdrop',startIndex:all.length,limit:200}).then(function(result){
          if(epoch!==generation || source!==clientIdentity() || !homeHost())return;
          all=all.concat(result.Items || []);
          if(result.Items && result.Items.length && all.length<result.TotalRecordCount)return page();
          channels=all;success=Date.now();loadArtwork();render();
        });
      }
      Promise.resolve().then(page).catch(function(){if(epoch===generation){failed=true;render();}}).then(function(){if(epoch===generation)pending=false;});
    }
    function schedule(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;refresh(false);},100);}
    window.addEventListener('hashchange',function(){updated=0;schedule();});
    window.addEventListener('focus',function(){refresh(true);});
    document.addEventListener('visibilitychange',function(){refresh(true);});
    new window.MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});schedule();
  }
  return {eventFor:eventFor,select:select,cleanTitle:cleanTitle,logo:logo,artworkFor:artworkFor,artworkDetailsFor:artworkDetailsFor,artworkChoices:artworkChoices,sportGraphic:sportGraphic,mount:mount};
}));
