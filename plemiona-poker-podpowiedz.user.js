// ==UserScript==
// @name         Plemiona – Plemienny Poker podpowiedź
// @namespace    plemiona.poker.helper
// @version      1.5
// @updateURL    https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-poker-podpowiedz.user.js
// @downloadURL  https://raw.githubusercontent.com/Rokerio/noweRepo/main/plemiona-poker-podpowiedz.user.js
// @description  Panel z podpowiedzią w evencie Plemienny Poker: atak/wymiana kart oraz wybór flag w sklepie. Nie klika za gracza.
// @match        https://*.plemiona.pl/game.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// rejestr wersji dla Sprawdzacza skryptów (localStorage, osobny na każdym urządzeniu)
try{var __r=JSON.parse(localStorage.getItem('gdp_registry')||'{}');__r['plemiona-poker-podpowiedz']={v:'1.5',t:Date.now()};localStorage.setItem('gdp_registry',JSON.stringify(__r));}catch(e){}


if(!/[?&]screen=event_siege_poker/.test(location.search)){ /* inny ekran – nic nie rób */ }
else
(function(){
if(window.__spHelper){window.__spHelper.toggle();return;}
var ICON={infantry:'🛡',archer:'🏹',cavalry:'🐴',siege:'💣'};
var RV={'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'j':11,'q':12,'k':13,'a':14};
var RL={11:'J',12:'Q',13:'K',14:'A'};
var NAMES={high:'Wysoka karta',pair:'Para',two:'Dwie pary',trips:'Trójka',straight:'Strit',flush:'Kolor',full:'Full',quad:'Kareta',sf:'Poker',rf:'Poker Królewski'};
var BASE={high:5,pair:20,two:50,trips:100,straight:125,flush:150,full:200,quad:400,sf:800,rf:1600};
/* jak łatwo trafić układ w 8 kartach przy 3 wymianach (0-1) */
/* wartość punktowa karty (liczy się tylko, gdy karta jest częścią układu) – do poprawienia, jeśli gra liczy inaczej */
var CV={'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'j':10,'q':10,'k':10,'a':11};
var VET_ON_CARDS=false;   /* true = Weteran podwaja też punkty kart, false = tylko bazę układu */
var HIGH_ADDS_VALUE=false; /* true = przy wysokiej karcie dolicz jej wartość do bazy 5 */
var HW={high:0.2,pair:1,two:0.85,trips:0.8,straight:0.35,flush:0.4,full:0.45,quad:0.12,sf:0.03,rf:0.01};
var SIMS=100;
var S={},SH={};
var lastSig=null,panel=null,visible=true,source='-',view='battle',FM={};

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function norm(c){
  var rk=String(c.rank).toLowerCase();
  return {suit:c.suit,rank:rk,r:RV[rk]||0,vet:!!(c.modifiers&&c.modifiers.indexOf('veteran')>-1)};
}
function lbl(c){return (RL[c.r]||c.r)+(ICON[c.suit]||c.suit.charAt(0))+(c.vet?'★':'');}
function lblAll(a){return a.map(lbl).join(' ');}
function key(c){return c.suit+c.rank;}
function vets(a){var n=0;for(var i=0;i<a.length;i++){if(a[i].vet)n++;}return n;}
function vfirst(a){return a.slice().sort(function(x,y){return (y.vet?1:0)-(x.vet?1:0)||y.r-x.r;});}

/* ---------- FLAGI ---------- */
function handOfSub(n){
  n=String(n||'').toLowerCase();
  if(/royal/.test(n))return 'rf';
  if(/straight_?flush/.test(n))return 'sf';
  if(/four|quad/.test(n))return 'quad';
  if(/full/.test(n))return 'full';
  if(/flush/.test(n))return 'flush';
  if(/straight/.test(n))return 'straight';
  if(/two_?pair/.test(n))return 'two';
  if(/three|trip/.test(n))return 'trips';
  if(/pair/.test(n))return 'pair';
  if(/high/.test(n))return 'high';
  return null;
}
function flagInfo(f){
  var st=f.sub_types||{};
  var val=Number(f.value)||0;
  var rand=/random|losow/i.test(String(f.key))||/^\s*\S*\s*0\s*%/.test(String(f.desc_stats||''))||/losow/i.test(String(f.desc||''));
  return {
    hand:handOfSub(st.poker_hand),
    special:st.special||null,
    val:val,
    eff:rand?val/2:val,
    rand:rand,
    level:Number(f.level)||1,
    text:(String(f.key)+' '+String(f.desc||'')).toLowerCase(),
    subs:Object.keys(st).map(function(k){return k+':'+st[k];})
  };
}
function styleOf(info){
  if(/maksymalnie\s*3|do\s*3\s*kart|nie\s*wi[eę]cej\s*ni[zż]\s*3/.test(info.text))return 'small';
  if(/wszystkie\s*(karty|niepunktuj)|5\s*kart|pi[eę][cć]\s*kart|pe[lł]ny\s*atak/.test(info.text))return 'full';
  return null;
}
function ownedFlags(){return (SH.flags&&SH.flags.length?SH.flags:(S.flags||[]));}

function scoreOffer(o,owned,maxFlags){
  var info=flagInfo(o),why=[],sc=0;
  var ownedInfo=owned.map(flagInfo);
  var same=null;
  owned.forEach(function(f){if(f.id===o.id)same=f;});

  if(o.key==='copy_flag'){
    if(!owned.length){sc=-40;why.push('brak flagi do skopiowania');}
    else{
      var bestE=0;ownedInfo.forEach(function(i){if(i.eff>bestE)bestE=i.eff;});
      sc=15+bestE*0.5;why.push('kopiuje jedną z '+owned.length+' posiadanych flag');
    }
  }else{
    sc=(o.scaling==='%'?info.eff*0.6:Math.min(info.eff,60)*0.5);
    if(info.rand)why.push('losowy zakres (średnio połowa wartości)');
    if(info.hand){
      var w=HW[info.hand]||0.3;
      sc*=(0.3+0.9*w);
      why.push('układ: '+NAMES[info.hand]+(w>=0.8?' (łatwo trafić)':w>=0.4?' (średnio często)':' (rzadko trafisz)'));
    }
    if(info.special==='all_discards'){sc*=0.7;why.push('wymaga zużycia wszystkich wymian');}
  }
  if(same){
    sc+=12+8*info.level;
    why.push('ulepsza posiadaną flagę (poz. '+(same.level||1)+')');
  }else if(info.hand){
    var n=ownedInfo.filter(function(i){return i.hand===info.hand;}).length;
    if(n){sc+=12*n;why.push('synergia: masz '+n+' flag(i) na '+NAMES[info.hand]);}
  }
  if(info.special){
    var m=ownedInfo.filter(function(i){return i.special===info.special;}).length;
    if(m){sc+=6*m;why.push('pasuje do Twoich flag ('+info.special+')');}
  }
  if(/weteran|veteran/.test(info.text)){
    sc+=8;why.push('premia za Weteranów');
    if(ownedInfo.some(function(i){return /weteran|veteran/.test(i.text);})){sc+=10;}
  }
  var st=styleOf(info);
  if(st){
    var clash=ownedInfo.some(function(i){var s2=styleOf(i);return s2&&s2!==st;});
    if(clash){sc-=25;why.push('kolizja stylu: mało kart vs pełna ręka');}
  }
  if(/konwert|zamienia|przekszta[lł]ca/.test(info.text))why.push('połóż na lewo od flag z premią punktową');
  if(!same&&owned.length>=maxFlags){sc-=8;why.push('brak wolnego slotu – trzeba coś wymienić');}
  return {sc:sc,why:why,name:o.name,level:info.level,rarity:o.rarity_text,stats:o.desc_stats,desc:o.desc,id:o.id};
}

function computeFM(){
  FM={};
  ownedFlags().forEach(function(f){
    var i=flagInfo(f);
    if(f.category==='attack_power'&&i.hand&&f.scaling==='%'&&/attack_power/.test(String(f.key))&&!/after/.test(String(f.key))){
      FM[i.hand]=(FM[i.hand]||1)*(1+i.eff/100);
    }
  });
}

/* ---------- UKŁADY ---------- */
function straightsOf(list){
  var m={};
  vfirst(list).forEach(function(c){if(!m[c.r])m[c.r]=c;});
  var out=[];
  for(var hi=14;hi>=5;hi--){
    var u=[];
    for(var k=0;k<5;k++){
      var r=hi-k;
      if(hi===5&&k===4)r=14;
      if(!m[r]){u=null;break;}
      u.push(m[r]);
    }
    if(u)out.push({u:u,hi:hi});
  }
  return out;
}

function bestHand(cards){
  var byR={},byS={},best=null;
  cards.forEach(function(c){
    (byR[c.r]=byR[c.r]||[]).push(c);
    (byS[c.suit]=byS[c.suit]||[]).push(c);
  });
  function consider(t,used){
    var cv=0;
    if(t!=='high'||HIGH_ADDS_VALUE){for(var q=0;q<used.length;q++)cv+=CV[used[q].rank]||0;}
    var sc=(VET_ON_CARDS?(BASE[t]+cv)*(1+vets(used)):BASE[t]*(1+vets(used))+cv)*(FM[t]||1);
    if(!best||sc>best.score)best={type:t,score:sc,used:used};
  }
  Object.keys(byS).forEach(function(s){
    var g=byS[s];
    if(g.length>=5){
      consider('flush',vfirst(g).slice(0,5));
      straightsOf(g).forEach(function(x){consider(x.hi===14?'rf':'sf',x.u);});
    }
  });
  straightsOf(cards).forEach(function(x){consider('straight',x.u);});
  var ranks=Object.keys(byR).map(Number);
  var pairs=[];
  ranks.forEach(function(r){
    var g=byR[r];
    if(g.length>=4)consider('quad',vfirst(g).slice(0,4));
    if(g.length>=3){
      consider('trips',vfirst(g).slice(0,3));
      ranks.forEach(function(p){
        if(p!==r&&byR[p].length>=2)consider('full',vfirst(g).slice(0,3).concat(vfirst(byR[p]).slice(0,2)));
      });
    }
    if(g.length>=2){consider('pair',vfirst(g).slice(0,2));pairs.push(r);}
  });
  for(var i=0;i<pairs.length;i++){
    for(var j=i+1;j<pairs.length;j++){
      consider('two',vfirst(byR[pairs[i]]).slice(0,2).concat(vfirst(byR[pairs[j]]).slice(0,2)));
    }
  }
  cards.forEach(function(c){consider('high',[c]);});
  return best;
}

function getDeck(hand){
  var inHand={};
  hand.forEach(function(c){inHand[key(c)]=1;});
  var src=S.cards_in_deck,d=[];
  if(Array.isArray(src)&&src.length){
    src.forEach(function(x){var c=norm(x);if(!inHand[key(c)])d.push(c);});
  }else{
    Object.keys(ICON).forEach(function(s){
      Object.keys(RV).forEach(function(r){
        var c=norm({suit:s,rank:r,modifiers:[]});
        if(!inHand[key(c)])d.push(c);
      });
    });
  }
  return d;
}

function simulate(hand,deck,defense){
  var n=hand.length,best=null;
  for(var m=1;m<(1<<n);m++){
    var k=0,keep=[],disc=[];
    for(var i=0;i<n;i++){
      if(m&(1<<i)){k++;disc.push(hand[i]);}else{keep.push(hand[i]);}
    }
    if(k>5||k>deck.length)continue;
    var sum=0,hit=0;
    for(var s=0;s<SIMS;s++){
      var pick=[],used={};
      while(pick.length<k){
        var ix=Math.floor(Math.random()*deck.length);
        if(used[ix])continue;
        used[ix]=1;
        var d=deck[ix];
        pick.push({suit:d.suit,rank:d.rank,r:d.r,vet:d.vet||Math.random()<0.1});
      }
      var sc=bestHand(keep.concat(pick)).score;
      sum+=sc;
      if(sc>=defense)hit++;
    }
    var mean=sum/SIMS;
    if(!best||mean>best.mean)best={mean:mean,p:hit/SIMS,disc:disc,keep:keep};
  }
  return best;
}

/* ---------- ODCZYT STANU ---------- */
var BKEYS=['cards_hand','cards_in_deck','castle','available_attacks','available_free_discards','flags'];
var SKEYS=['flag_shop_offers','flags','max_amount_flags','count_available_takes','available_free_flag_rerolls','max_free_flag_rerolls','next_castle','taken_offer_ids'];
function mergeB(o){BKEYS.forEach(function(k){if(o[k]!==undefined)S[k]=o[k];});}
function mergeS(o){SKEYS.forEach(function(k){if(o[k]!==undefined)SH[k]=o[k];});}

function findKey(o,k,depth,seen){
  if(!o||typeof o!=='object'||depth>6)return null;
  if(o.nodeType||o.jquery||o===window||seen.has(o))return null;
  seen.add(o);
  if(Array.isArray(o[k]))return o;
  for(var p in o){
    try{
      var v=o[p];
      if(v&&typeof v==='object'){
        var r=findKey(v,k,depth+1,seen);
        if(r)return r;
      }
    }catch(e){}
  }
  return null;
}
function getSP(){try{if(typeof SiegePoker!=='undefined')return SiegePoker;}catch(e){}return window.SiegePoker||null;}
function getFS(){try{if(typeof SiegePokerFlagShop!=='undefined')return SiegePokerFlagShop;}catch(e){}return window.SiegePokerFlagShop||null;}

function extractObj(txt,start){
  var d=0,inS=false,q='',esc2=false;
  for(var i=start;i<txt.length;i++){
    var c=txt.charAt(i);
    if(inS){
      if(esc2)esc2=false;
      else if(c==='\\')esc2=true;
      else if(c===q)inS=false;
      continue;
    }
    if(c==='"'||c==="'"){inS=true;q=c;continue;}
    if(c==='{')d++;
    else if(c==='}'){d--;if(d===0)return txt.slice(start,i+1);}
  }
  return null;
}
function parseText(t,marker,needle){
  if(t.indexOf(needle)<0)return null;
  var idx=t.indexOf(marker);
  if(idx<0)return null;
  var js=extractObj(t,t.indexOf('{',idx));
  if(!js)return null;
  try{return JSON.parse(js);}catch(e){}
  return null;
}
function parseInline(marker,needle){
  var sc=document.scripts||[];
  for(var i=0;i<sc.length;i++){
    var r=parseText(sc[i].textContent||'',marker,needle);
    if(r)return r;
  }
  return null;
}

/* ---------- ZGODNOŚĆ Z EKRANEM + SAMODZIELNE ODŚWIEŻANIE ---------- */
function vis(id){
  var e=document.getElementById(id);
  if(!e)return false;
  return e.getClientRects?e.getClientRects().length>0:true;
}
function num(s){var m=String(s||'').replace(/[\s .]/g,'').match(/\d+/);return m?Number(m[0]):null;}
function tx(id){var e=document.getElementById(id);return e?(e.textContent||''):'';}
function domState(){
  var a=tx('btn_attack_stats').match(/(\d+)\s*\/\s*(\d+)/);
  var x=tx('btn_discard_stats').match(/(\d+)\s*\/\s*(\d+)/);
  return {castle:num(tx('castle_number_value')),def:num(tx('castle_defense_power_value')),att:a?Number(a[1]):null,dis:x?Number(x[1]):null};
}
function consistent(st){
  if(!vis('hand_cards'))return true;
  var d=domState(),c=st.castle||{};
  if(d.castle!=null&&c.number!=null&&d.castle!==Number(c.number))return false;
  if(d.def!=null&&c.defense_power!=null&&d.def!==Number(c.defense_power))return false;
  if(d.att!=null&&st.available_attacks!=null&&d.att!==Number(st.available_attacks))return false;
  if(d.dis!=null&&st.available_free_discards!=null&&d.dis!==Number(st.available_free_discards))return false;
  return true;
}
var fetching=false,lastFetch=0,tried={},lastSeenView=null;
function refresh(why){
  if(fetching||Date.now()-lastFetch<1500)return false;
  fetching=true;lastFetch=Date.now();
  try{
    fetch(location.href,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.text();}).then(function(t){
      fetching=false;
      var b=parseText(t,'const data = {','cards_hand');
      var s=parseText(t,'const flag_shop = {','flag_shop_offers');
      if(b){S={};}
      if(b||s)ingest(b,s,'odświeżenie ('+why+')');
    }).catch(function(){fetching=false;});
  }catch(e){fetching=false;return false;}
  return true;
}
function watch(){
  var v=currentView();
  if(lastSeenView===null)lastSeenView=v;
  else if(v!==lastSeenView){lastSeenView=v;refresh('zmiana ekranu');return;}
  if(S.cards_hand&&v==='battle'&&!consistent(S)){
    var k=JSON.stringify(domState());
    if((tried[k]||0)<2&&refresh('rozjazd z ekranem'))tried[k]=(tried[k]||0)+1;
  }
}

function currentView(){
  if(vis('flag_shop_offer_slot_1'))return 'shop';
  if(vis('hand_cards'))return 'battle';
  return view;
}

function ingest(b,s,src){
  if(b)mergeB(b);
  if(s)mergeS(s);
  if(b||s)source=src;
  var v=currentView();
  var sig=JSON.stringify([S.cards_hand,S.available_attacks,S.available_free_discards,S.castle&&S.castle.defense_power,S.castle&&S.castle.number,S.flags,SH.flag_shop_offers,SH.flags,SH.count_available_takes,SH.available_free_flag_rerolls,v]);
  if(sig===lastSig)return;
  lastSig=sig;
  view=v;
  render();
}

function poll(){
  try{
    var sp=getSP(),fs=getFS();
    var b=sp?findKey(sp,'cards_hand',0,new Set()):null;
    var s=fs?findKey(fs,'flag_shop_offers',0,new Set()):null;
    var src='obiekt gry';
    if(b&&S.cards_hand&&!consistent(b))b=null; /* stary stan z obiektu gry – ignoruj */
    if(!b&&!S.cards_hand){b=parseInline('const data = {','cards_hand');if(b)src='dane strony';}
    if(!s&&!SH.flag_shop_offers){s=parseInline('const flag_shop = {','flag_shop_offers');if(s)src='dane strony';}
    if(b||s||lastSig!==null){ingest(b,s,src);}
    if(!S.cards_hand&&!SH.flag_shop_offers)renderDiag(sp,fs);
    watch();
  }catch(e){console.log('[SPHelper]',e);}
}
function onResp(resp,src){
  try{
    var b=findKey(resp,'cards_hand',0,new Set());
    var s=findKey(resp,'flag_shop_offers',0,new Set());
    if(b||s)ingest(b,s,src);
  }catch(e){}
}

/* ---------- PANEL ---------- */
function ensurePanel(){
  if(panel)return panel;
  panel=document.createElement('div');
  panel.id='sp_helper_panel';
  panel.style.cssText='position:fixed;top:60px;right:10px;width:330px;max-height:80vh;overflow:auto;z-index:99999;background:#1e1e1e;color:#eee;border:2px solid #c9a227;border-radius:6px;padding:8px 10px;font:12px/1.45 Arial,sans-serif;box-shadow:0 2px 10px #0008;';
  document.body.appendChild(panel);
  return panel;
}
function head(t){
  return '<div style="display:flex;justify-content:space-between;font-weight:bold;color:#c9a227;margin-bottom:4px"><span>♠ '+(t||'Poker – podpowiedź')+'</span><a href="#" id="sp_close" style="color:#c9a227">✕</a></div>';
}
function bind(){
  var x=document.getElementById('sp_close');
  if(x)x.onclick=function(e){e.preventDefault();window.__spHelper.toggle();};
}
var diagLogged=false;
function renderDiag(sp,fs){
  var p=ensurePanel();
  if(!diagLogged){diagLogged=true;console.log('[SPHelper] SiegePoker:',sp,'FlagShop:',fs);}
  p.innerHTML=head()+'<div>Skrypt działa, ale nie znalazłem stanu gry.<br>SiegePoker: <b>'+(sp?'jest':'brak')+'</b>, sklep flag: <b>'+(fs?'jest':'brak')+'</b>.<br>Odśwież stronę pokera (F5). Dane pojawią się też po pierwszym ruchu.</div>';
  bind();
}

function flagsLine(){
  var o=ownedFlags();
  if(!o.length)return '<div style="color:#bbb">Flagi: brak</div>';
  return '<div style="color:#bbb">Flagi ('+o.length+'/'+(SH.max_amount_flags||S.max_flags||6)+'): '+o.map(function(f){return esc(f.name||f.key)+' p.'+(f.level||1);}).join(', ')+'</div>';
}

function renderShop(){
  var p=ensurePanel();
  var owned=ownedFlags();
  var max=SH.max_amount_flags||6;
  var offers=(SH.flag_shop_offers||[]).map(function(o){return scoreOffer(o,owned,max);});
  offers.sort(function(a,b){return b.sc-a.sc;});
  var nc=SH.next_castle||{};
  var h=head('Poker – wybór flagi');
  h+='<div>Następny zamek: <b>'+(nc.number||'?')+'</b>, obrona: <b>'+(nc.defense_power||'?')+'</b> | do wzięcia: <b>'+(SH.count_available_takes==null?'?':SH.count_available_takes)+'</b> | darmowe losowania: <b>'+(SH.available_free_flag_rerolls||0)+'</b></div>';
  h+=flagsLine();
  if(SH.count_available_takes===0)h+='<div style="margin-top:6px;color:#ff9f5a">Nic już nie możesz wziąć w tym sklepie.</div>';
  offers.forEach(function(r,i){
    var col=i===0?'#7fd37f':'#666';
    h+='<div style="margin-top:6px;padding:6px;border-radius:4px;background:#2b2b2b;border-left:4px solid '+col+'">';
    h+='<b>'+(i===0?'★ WYBIERZ: ':(i+1)+'. ')+esc(r.name)+'</b> <span style="color:#999">(poz. '+r.level+', '+esc(r.rarity||'')+')</span> – ocena <b>'+Math.round(r.sc)+'</b>';
    if(r.stats)h+='<br><span style="color:#bbb">'+esc(r.stats)+'</span>';
    if(r.why.length)h+='<br><span style="color:#9ad">'+r.why.map(esc).join('; ')+'</span>';
    h+='</div>';
  });
  if(offers.length&&offers[0].sc<12){
    h+='<div style="margin-top:6px;color:#ffcf5a">Wszystkie oferty są słabe'+((SH.available_free_flag_rerolls||0)>0?' – użyj darmowego losowania.':'.')+'</div>';
  }
  h+='<div style="margin-top:6px;color:#999;font-size:11px">Ocena to heurystyka z poradnika: płynność ponad rzadkość, ulepszanie flag rdzenia, synergia układów, brak kolizji (3 karty vs 5 kart). Flagi konwertujące karty trzymaj po lewej.<br>Źródło danych: '+esc(source)+'</div>';
  p.innerHTML=h;
  bind();
}

function renderBattle(){
  if(!S.cards_hand)return renderShopOrWait();
  var p=ensurePanel();
  computeFM();
  var hand=S.cards_hand.map(norm);
  var castle=S.castle||{};
  var defense=Number(castle.defense_power)||0;
  var att=S.available_attacks,dis=S.available_free_discards;
  var now=bestHand(hand);
  var deck=getDeck(hand);
  var h=head();
  h+='<div>Zamek <b>'+(castle.number||'?')+'</b> | obrona: <b>'+defense+'</b> | ataki: <b>'+att+'</b> | wymiany: <b>'+dis+'</b></div>';
  h+='<div style="margin:4px 0;color:#bbb">Ręka: '+lblAll(vfirst(hand))+'</div>';
  h+=flagsLine();
  var fmKeys=Object.keys(FM);
  if(fmKeys.length)h+='<div style="color:#9ad">Mnożniki flag: '+fmKeys.map(function(k){return NAMES[k]+' ×'+FM[k].toFixed(2);}).join(', ')+'</div>';
  h+='<div style="margin-top:4px">Najlepszy układ: <b>'+NAMES[now.type]+'</b> ('+lblAll(now.used)+') ≈ <b>'+Math.round(now.score)+'</b></div>';
  /* obrażenia sumują się między atakami: trzeba zebrać łącznie "defense" w ciągu "att" ataków */
  var left=Math.max(1,att||1);
  var pace=defense/left;
  h+='<div style="color:#bbb">Potrzeba średnio <b>'+Math.round(pace)+'</b> na atak ('+defense+' / '+left+')</div>';
  var rec='',color='#7fd37f';
  var bd=null;
  if(dis>0&&deck.length>0)bd=simulate(hand,deck,pace);
  if(now.score>=defense&&defense>0){
    rec='ATAKUJ – zaznacz: '+lblAll(now.used)+'.<br>Ten atak dobija zamek (oszczędzasz ataki i wymiany = bonus monet).';
  }else if(left>1&&now.score>=pace*0.9){
    rec='ATAKUJ – zaznacz: '+lblAll(now.used)+'.<br>Zadasz ≈ '+Math.round(now.score)+' ('+Math.round(now.score/defense*100)+'% obrony). To wystarcza w tempie – wymiany zostaw na kolejne ataki.';
  }else if(bd&&bd.mean>now.score*1.25){
    color='#ffcf5a';
    rec='ODRZUĆ: '+lblAll(bd.disc)+'<br>Zostaw: '+lblAll(bd.keep)+'<br>Oczekiwany wynik ≈ '+Math.round(bd.mean)+', szansa na ≥ '+Math.round(pace)+': '+Math.round(bd.p*100)+'%';
  }else{
    rec='ATAKUJ – zaznacz: '+lblAll(now.used);
    if(left<=1){color='#ff7a7a';rec+='<br>Uwaga: to ostatni atak, a szacunek jest poniżej obrony.';}
  }
  h+='<div style="margin-top:6px;padding:6px;border-radius:4px;background:#2b2b2b;border-left:4px solid '+color+'">'+rec+'</div>';
  if(castle.ability_desc||castle.is_joker){
    h+='<div style="margin-top:6px;color:#ff9f5a">Boss: '+esc(castle.ability_desc||'Joker')+' – sprawdź warunek przed atakiem.</div>';
  }
  h+='<div style="margin-top:6px;color:#999;font-size:11px">★ = Weteran (+100% bazy układu). Wynik = baza układu × (1+Weterani) + punkty kart w układzie (2–10, figury 10, As 11). Uwzględniam tylko proste flagi procentowe na układ; pozostałe flagi liczą się w grze dodatkowo. Uderzenie poniżej 33% obrony zamienia losową kartę w Weterana.<br>Źródło danych: '+esc(source)+'</div>';
  p.innerHTML=h;
  bind();
}
function renderShopOrWait(){
  if(SH.flag_shop_offers)return renderShop();
}
function render(){
  if(view==='shop'&&SH.flag_shop_offers)return renderShop();
  if(S.cards_hand)return renderBattle();
  if(SH.flag_shop_offers)return renderShop();
}

window.__spHelper={
  toggle:function(){
    visible=!visible;
    if(panel)panel.style.display=visible?'block':'none';
  }
};

try{
  var oSend=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(){
    var x=this;
    x.addEventListener('load',function(){
      try{
        var t=x.responseText;
        if(t&&(t.indexOf('cards_hand')>-1||t.indexOf('flag_shop_offers')>-1))onResp(JSON.parse(t),'odpowiedź serwera');
      }catch(e){}
    });
    return oSend.apply(this,arguments);
  };
}catch(e){}
if(window.jQuery){
  jQuery(document).ajaxSuccess(function(e,xhr){
    var r=xhr&&xhr.responseJSON;
    if(r)setTimeout(function(){onResp(r,'AJAX');},50);
  });
}

ensurePanel().innerHTML=head()+'<div>Skrypt załadowany, szukam danych gry…</div>';
bind();
setInterval(poll,700);
poll();
})();
