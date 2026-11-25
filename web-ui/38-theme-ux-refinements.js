/* Reviewed Zorofin web refinements. Native Jellyfin routes, actions and queries
 * retain ownership. This module is shipped by the plugin's webUi pack. */
(function(root){
  'use strict';
  var suggestions=[['New York Knicks','NBA'],['Boston Celtics','NBA'],['Washington Commanders','NFL'],['Philadelphia Eagles','NFL'],['New York Yankees','MLB'],['Baltimore Orioles','MLB'],['Washington Capitals','NHL'],['Boston Bruins','NHL'],['Washington Mystics','WNBA'],['Seattle Storm','WNBA'],['D.C. United','Soccer'],['Arsenal','Soccer'],['Pakistan','Cricket'],['New Zealand','Rugby']];
  function teamNames(text){var seen=new Set();return String(text||'').split(',').map(function(v){return v.trim();}).filter(function(v){var key=v.toLowerCase();if(!v||seen.has(key))return false;seen.add(key);return true;});}
  if(typeof module==='object'&&module.exports){module.exports={suggestions:suggestions,teamNames:teamNames};return;}
  if(!root||!root.document||root.zorofinUxRefinementsLoaded)return;
  root.zorofinUxRefinementsLoaded=true;
  var doc=root.document,queued=false,pickers=new WeakMap();
  function node(tag,cls,text){var e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function button(text,run){var b=node('button','zoroUxChoice focusable',text);b.type='button';b.addEventListener('click',run);return b;}
  function shown(e){return e&&!e.closest('.hide,[hidden]')&&root.getComputedStyle(e).display!=='none';}
  function detailActions(){
    doc.querySelectorAll('#itemDetailPage.zoro-detail-v3').forEach(function(page){
      if(!shown(page))return;
      var resume=page.querySelector('.btnPlay:not(.hide)');
      page.querySelectorAll('.mainDetailButtons .detailButton').forEach(function(b){
        var label=b.classList.contains('btnUserRating')?'Favorite':b.classList.contains('btnPlaystate')?'Watched':b.classList.contains('btnDownload')?'Download':b.classList.contains('btnReplay')&&shown(resume)?'Start over':'';
        var content=b.querySelector('.detailButton-content');if(!content)return;
        var caption=content.querySelector('.zoroUxActionLabel');
        if(!label){if(caption)caption.remove();if(b.classList.contains('zoroUxActionButton'))b.classList.remove('zoroUxActionButton');return;}
        if(!b.classList.contains('zoroUxActionButton'))b.classList.add('zoroUxActionButton');
        if(!caption){caption=node('span','zoroUxActionLabel');caption.setAttribute('aria-hidden','true');content.appendChild(caption);}
        if(caption.textContent!==label)caption.textContent=label;
      });
    });
    doc.querySelectorAll('#itemDetailPage:not(.zoro-detail-v3) .zoroUxActionLabel').forEach(function(e){(e.closest('button')||{classList:{remove:function(){}}}).classList.remove('zoroUxActionButton');e.remove();});
  }
  function attachTeams(input){
    if(pickers.has(input)){pickers.get(input)();return;}
    var panel=node('section','zoroUxTeams');panel.setAttribute('aria-label','Suggested teams');
    var searchLabel=node('label','zoroUxField','Find suggested teams'),search=node('input');search.type='search';search.placeholder='Search teams';searchLabel.appendChild(search);
    var leagueLabel=node('label','zoroUxField','Sport or league'),league=node('select');
    ['All'].concat(Array.from(new Set(suggestions.map(function(t){return t[1];})))).forEach(function(name){var o=node('option','',name);o.value=name;league.appendChild(o);});leagueLabel.appendChild(league);
    var selected=node('div','zoroUxSelected'),grid=node('div','zoroUxSuggestions'),status=node('p','zoroUxTeamStatus');status.setAttribute('role','status');
    panel.append(selected,searchLabel,leagueLabel,grid,status);
    input.closest('label')?input.closest('label').before(panel):input.before(panel);
    var signature='';
    function update(){
      var key=JSON.stringify([input.value,input.disabled,search.value,league.value]);if(signature===key)return;signature=key;
      var focused=panel.contains(doc.activeElement)&&doc.activeElement.dataset.team,focusedRole=focused&&doc.activeElement.dataset.teamRole;
      var chosen=teamNames(input.value),q=search.value.trim().toLowerCase();selected.replaceChildren();grid.replaceChildren();
      function choose(name,add){
        var values=teamNames(input.value).filter(function(t){return t.toLowerCase()!==name.toLowerCase();});
        if(add){if(values.length>=12){status.textContent='Choose up to 12 teams.';return;}values.push(name);}
        input.value=values.join(', ');input.dispatchEvent(new root.Event('input',{bubbles:true}));
      }
      chosen.forEach(function(name){var b=button(name+' ×',function(){choose(name,false);});b.dataset.team=name;b.dataset.teamRole='selected';b.setAttribute('aria-label','Remove '+name);b.disabled=input.disabled;selected.appendChild(b);});
      suggestions.filter(function(t){return (league.value==='All'||t[1]===league.value)&&t[0].toLowerCase().includes(q);}).forEach(function(t){
        var on=chosen.some(function(v){return v.toLowerCase()===t[0].toLowerCase();});var b=button(t[0]+' · '+t[1],function(){choose(t[0],!on);});b.dataset.team=t[0];b.dataset.teamRole='suggested';b.setAttribute('aria-pressed',String(on));b.disabled=input.disabled;grid.appendChild(b);
      });
      if(focused){var retained=Array.from(panel.querySelectorAll('button')).find(function(b){return b.dataset.team===focused&&b.dataset.teamRole===focusedRole;});if(retained)retained.focus({preventScroll:true});else input.focus({preventScroll:true});}
      status.textContent=grid.children.length?'Suggestions are optional. Add teams from any sport in Your teams below.':'Add this team in Your teams below, using its name from your guide.';
    }
    search.addEventListener('input',update);league.addEventListener('change',update);input.addEventListener('input',update);pickers.set(input,update);update();
  }
  function labelNativeControls(){
    // Jellyfin's own menus keep filtering/sorting server-side across all pages.
    doc.querySelectorAll('#moviesPage,#tvShowsPage,#tvRecommendedPage,.libraryPage').forEach(function(page){
      if(!shown(page)||page.matches('.homePage,#homePage'))return;
      page.querySelectorAll('.btnSort,.btnFilter').forEach(function(b){
        var label=b.classList.contains('btnSort')?'Sort':'Filters';
        if(!b.querySelector('.zoroUxControlLabel')){b.appendChild(node('span','zoroUxControlLabel',label));b.classList.add('zoroUxNativeControl');}
      });
    });
    doc.querySelectorAll('.zoro-live-tv-active .btnSelectDate,.zoro-live-tv-active .btnDate').forEach(function(b){
      if(!b.querySelector('.zoroUxControlLabel')){b.appendChild(node('span','zoroUxControlLabel','Guide date'));b.classList.add('zoroUxNativeControl');}
    });
  }
  function guideDates(){
    doc.querySelectorAll('.zoro-live-tv-active .guideHeaderDateSelection').forEach(function(header){
      var tabs=Array.from(header.querySelectorAll('.guide-date-tab-button'));if(!tabs.length)return;
      var field=header.querySelector('.zoroUxGuideDates'),select;
      if(!field){field=node('label','zoroUxField zoroUxGuideDates','Guide date');select=node('select','focusable');select.setAttribute('aria-label','Guide date');field.appendChild(select);header.prepend(field);select.addEventListener('change',function(){var available=header.querySelectorAll('.guide-date-tab-button');var tab=available[Number(select.value)];if(tab&&!tab.disabled)tab.click();});}else select=field.querySelector('select');
      var signature=JSON.stringify(tabs.map(function(t){return [t.textContent,t.disabled,t.classList.contains('emby-tab-button-active'),t.getAttribute('aria-selected')];}));
      if(field.dataset.signature===signature)return;field.dataset.signature=signature;select.replaceChildren();tabs.forEach(function(t,i){var o=node('option','',t.textContent.trim());o.value=String(i);o.disabled=t.disabled;o.selected=t.classList.contains('emby-tab-button-active')||t.getAttribute('aria-selected')==='true';select.appendChild(o);});
    });
  }
  function apply(){queued=false;detailActions();doc.querySelectorAll('#zphTeams,#zhrTeams').forEach(attachTeams);labelNativeControls();guideDates();}
  function schedule(){if(queued)return;queued=true;root.setTimeout(apply,80);}
  new root.MutationObserver(schedule).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled']});
  root.addEventListener('hashchange',schedule);doc.addEventListener('viewshow',schedule);schedule();
}(typeof window==='undefined'?null:window));
