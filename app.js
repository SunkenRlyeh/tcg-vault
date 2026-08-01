(function(){
"use strict";

// ---------- Utilities ----------
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
  });
}
var escapeAttr = escapeHtml;
function uniqSorted(arr){ return Array.from(new Set(arr.filter(Boolean))).sort(); }
function numOrInf(v){ var n=parseInt(v,10); return isNaN(n)?999:n; }

function normalizeImageUrl(url){
  if(!url) return url;
  // The official Gundam site now emits cache-buster URLs as "?260715=".
  // Keep older generated data working by normalizing before rendering/caching.
  if(url.indexOf('gundam-gcg.com/') !== -1){
    return url.replace(/(\.webp\?\d+)$/, '$1=');
  }
  return url;
}

function firstPresent(obj, keys){
  for(var i=0; i<keys.length; i++){
    if(obj && obj[keys[i]] != null && obj[keys[i]] !== '') return obj[keys[i]];
  }
  return null;
}

function colorToHex(color){
  if(!color) return '#4f8cff';
  var c = color.toLowerCase();
  if(c.indexOf('red')>=0) return '#e5484d';
  if(c.indexOf('blue')>=0) return '#4f8cff';
  if(c.indexOf('green')>=0) return '#37c26f';
  if(c.indexOf('purple')>=0) return '#a26fe0';
  if(c.indexOf('black')>=0) return '#7d8290';
  if(c.indexOf('yellow')>=0) return '#e8b339';
  if(c.indexOf('white')>=0) return '#d8dbe3';
  return '#4f8cff';
}

// ---------- Offline image cache (selective: only owned / decked cards) ----------
var IMAGE_CACHE = 'tcgvault-images-v1';
var CACHE_SUPPORTED = (typeof window !== 'undefined') && ('caches' in window) &&
  (location.protocol === 'https:' || location.hostname === 'localhost');
function cacheImage(url){
  url = normalizeImageUrl(url);
  if(!url || !CACHE_SUPPORTED) return;
  caches.open(IMAGE_CACHE).then(function(cache){
    cache.match(url).then(function(hit){
      if(hit) return;
      // Card art hosts (optcgapi.com / gundam-gcg.com) don't send CORS headers,
      // so a normal cors-mode fetch/cache.add() is rejected outright. Fetch in
      // no-cors mode (same as an <img> tag) to get an opaque response we can
      // still store and later serve from Cache Storage.
      fetch(url, { mode: 'no-cors' }).then(function(resp){
        cache.put(url, resp);
      }).catch(function(){ /* offline or blocked - ignore */ });
    });
  });
}
function uncacheImage(url){
  url = normalizeImageUrl(url);
  if(!url || !CACHE_SUPPORTED) return;
  caches.open(IMAGE_CACHE).then(function(cache){ cache.delete(url); });
}
function countCachedImages(cb){
  if(!CACHE_SUPPORTED){ cb(0); return; }
  caches.open(IMAGE_CACHE).then(function(cache){ cache.keys().then(function(keys){ cb(keys.length); }); });
}

// ---------- Persistent state ----------
var STORAGE_KEY = 'tcgvault_v1';
function defaultState(){
  return {
    collection: { onepiece:{}, gundam:{} },
    decks: { onepiece:[], gundam:[] },
    activeDeck: { onepiece:null, gundam:null }
  };
}
var state;
try {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
} catch(e) { state = defaultState(); }
state.collection = state.collection || { onepiece:{}, gundam:{} };
state.decks = state.decks || { onepiece:[], gundam:[] };
state.activeDeck = state.activeDeck || { onepiece:null, gundam:null };
state.decks.onepiece = state.decks.onepiece || [];
state.decks.gundam = state.decks.gundam || [];
state.decks.onepiece.forEach(function(deck){ deck.dons = deck.dons || {}; deck.tokens = deck.tokens || {}; });
state.decks.gundam.forEach(function(deck){ deck.resources = deck.resources || {}; deck.tokens = deck.tokens || {}; });

function saveState(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ /* storage full or unavailable */ }
}

// ---------- Card index ----------
var gameIndexCache = {};
function getIndex(game){
  if(gameIndexCache[game]) return gameIndexCache[game];
  var cards = game === 'onepiece' ? (window.ONEPIECE_CARDS||[]) : (window.GUNDAM_CARDS||[]);
  var byId = {};
  var byNumber = {};
  cards.forEach(function(c){
    byId[c.id] = c;
    var key = c.number || c.id;
    (byNumber[key] = byNumber[key] || []).push(c);
  });
  var canonical = Object.keys(byNumber).map(function(num){
    var variants = byNumber[num];
    var exact = variants.filter(function(v){ return v.id === num; })[0];
    if(exact) return exact;
    return variants.slice().sort(function(a,b){ return a.id.length - b.id.length; })[0];
  });
  var setNames = {};
  cards.forEach(function(c){ if(c.set_code && !setNames[c.set_code]) setNames[c.set_code] = c.set_name; });
  var idx = {
    cards: cards,
    byId: byId,
    byNumber: byNumber,
    canonical: canonical,
    sets: uniqSorted(cards.map(function(c){ return c.set_code; })),
    colors: uniqSorted(cards.reduce(function(acc,c){ return acc.concat((c.color||'').split(/[\s,\/]+/)); }, [])),
    types: uniqSorted(cards.map(function(c){ return c.type; })),
    rarities: uniqSorted(cards.map(function(c){ return c.rarity; })),
    setNames: setNames
  };
  gameIndexCache[game] = idx;
  return idx;
}
function getCardById(game, id){ return getIndex(game).byId[id]; }
function invalidateIndex(game){
  if(game) delete gameIndexCache[game];
  else gameIndexCache = {};
}
function mergeCards(game, incoming){
  var target = game === 'onepiece' ? (window.ONEPIECE_CARDS = window.ONEPIECE_CARDS || []) : (window.GUNDAM_CARDS = window.GUNDAM_CARDS || []);
  var seen = {};
  target.forEach(function(c){ if(c && c.id) seen[c.id] = true; });
  var added = 0;
  incoming.forEach(function(c){
    if(!c || !c.id || seen[c.id]) return;
    target.push(c);
    seen[c.id] = true;
    added++;
  });
  if(added) invalidateIndex(game);
  return added;
}
function parseEnvelope(payload){
  if(Array.isArray(payload)) return payload;
  if(payload && Array.isArray(payload.data)) return payload.data;
  if(payload && Array.isArray(payload.results)) return payload.results;
  if(payload && Array.isArray(payload.cards)) return payload.cards;
  return [];
}
function fetchJson(url){
  return fetch(url, { cache: 'no-store' }).then(function(resp){
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  });
}
function optcgImageUrl(imageId){
  if(!imageId) return null;
  var s = String(imageId);
  if(/^https?:\/\//i.test(s)) return s;
  return 'https://optcgapi.com/media/static/Card_Images/' + s.replace(/\.(jpg|png|webp)$/i, '') + '.jpg';
}
function normalizeOnePieceDon(raw, pos){
  var id = firstPresent(raw, ['id','card_id','cardID','don_id','donID','image_id','imageID','imageId']);
  var imageId = firstPresent(raw, ['image_id','imageID','imageId','image','img','card_image','cardImage']);
  var name = firstPresent(raw, ['name','card_name','cardName','don_name','donName']) || 'DON!! Card';
  var fullName = firstPresent(raw, ['full_name','fullName','don_full_name','donFullName','display_name','displayName']);
  var setName = firstPresent(raw, ['set_name','setName','deck_name','deckName','product_name','productName']);
  var setCode = firstPresent(raw, ['set_code','setCode','set_id','setId','deck_id','deckId']);
  var number = firstPresent(raw, ['number','card_number','cardNumber']);
  if(!id) id = imageId || number || ('don_' + (pos + 1));
  if(!number) number = String(id).toUpperCase().indexOf('DON') === 0 ? id : String(id);
  return {
    id: String(id),
    number: String(number),
    game: 'onepiece',
    name: String(name),
    set_code: setCode ? String(setCode) : 'DON',
    set_name: setName ? String(setName) : (fullName ? String(fullName).replace(/^.* - /, '') : 'DON!! Cards'),
    rarity: firstPresent(raw, ['rarity']) || 'DON!!',
    type: 'DON!!',
    color: '',
    cost: null,
    power: null,
    life: null,
    counter: null,
    attribute: null,
    traits: '',
    text: fullName || '',
    image_url: optcgImageUrl(imageId || id),
    price: firstPresent(raw, ['market_price','marketPrice','price','inventory_price','inventoryPrice'])
  };
}
function normalizeGundamCard(raw){
  var id = firstPresent(raw, ['product_id','id']);
  var num = firstPresent(raw, ['card_number','number']) || id;
  var traits = raw.traits || raw.trait || '';
  var links = raw.link_refs || raw.link || '';
  return {
    id: String(id || num),
    number: String(num || id),
    game: 'gundam',
    name: firstPresent(raw, ['name']) || '',
    set_code: firstPresent(raw, ['set_code']) || '',
    set_name: firstPresent(raw, ['set_name','where_to_get']) || '',
    rarity: firstPresent(raw, ['rarity']) || '',
    type: firstPresent(raw, ['card_type','type']) || '',
    color: firstPresent(raw, ['color']) || '',
    cost: firstPresent(raw, ['cost']),
    level: firstPresent(raw, ['level']),
    ap: firstPresent(raw, ['ap','ap_raw']),
    hp: firstPresent(raw, ['hp','hp_raw']),
    zone: firstPresent(raw, ['zone']) || '-',
    traits: Array.isArray(traits) ? traits.join(', ') : String(traits || ''),
    link: Array.isArray(links) ? links.join(', ') : String(links || '-'),
    text: firstPresent(raw, ['effect','text']) || '',
    image_url: normalizeImageUrl(firstPresent(raw, ['image_url'])),
    price: null
  };
}
function hydrateRemoteCards(){
  var tasks = [];
  tasks.push(fetchJson('https://www.optcgapi.com/api/allDonCards/').then(function(payload){
    var cards = parseEnvelope(payload).map(normalizeOnePieceDon).filter(function(c){ return c.image_url; });
    return mergeCards('onepiece', cards);
  }).catch(function(){ return 0; }));

  ['ST01','ST02','ST03','ST04','ST05','ST06','ST07','ST08','ST09','ST10'].forEach(function(setCode){
    tasks.push(fetchJson('https://api.gcgapi.com/v1/sets/' + setCode + '/cards').then(function(payload){
      var cards = parseEnvelope(payload).map(normalizeGundamCard);
      return mergeCards('gundam', cards);
    }).catch(function(){ return 0; }));
  });

  Promise.all(tasks).then(function(results){
    var total = results.reduce(function(a,b){ return a + b; }, 0);
    if(!total) return;
    renderFilterOptions();
    renderCurrentView();
  });
}

// ---------- App state ----------
var currentGame = 'onepiece';
var currentTab = 'browse';
var filters = { search:'', set:'', color:'', type:'', rarity:'', sort:'set' };
var deckSearchTerm = '';
var onePieceAllowAnyColor = false;

// ---------- Collection helpers (keyed by exact printing id - each art is distinct) ----------
function collectionQty(game, id){
  var e = state.collection[game][id];
  return e ? (e.qty||0) : 0;
}
function collectionPrice(game, id){
  var e = state.collection[game][id];
  return e && e.price != null ? e.price : null;
}
function setCollectionQty(game, id, qty){
  var prev = collectionQty(game, id);
  var next = Math.max(0, qty);
  if(!state.collection[game][id]) state.collection[game][id] = {qty:0, price:null};
  state.collection[game][id].qty = next;
  saveState();
  if(prev === 0 && next > 0){
    var c = getCardById(game, id);
    if(c) cacheImage(c.image_url);
  }
}
function setCollectionPrice(game, id, price){
  if(!state.collection[game][id]) state.collection[game][id] = {qty:0, price:null};
  state.collection[game][id].price = isNaN(price) ? null : price;
  saveState();
}
function ownedQtyByNumber(game, num){
  var idx = getIndex(game);
  var variants = idx.byNumber[num] || [];
  var sum = 0;
  variants.forEach(function(v){ sum += collectionQty(game, v.id); });
  return sum;
}
function adjustOwnedByNumber(game, num, delta){
  var idx = getIndex(game);
  var canonical = (idx.byNumber[num]||[])[0];
  if(!canonical) return;
  setCollectionQty(game, canonical.id, collectionQty(game, canonical.id) + delta);
}

// ---------- Deck helpers ----------
function getDecks(game){ return state.decks[game]; }
function getActiveDeck(game){
  var id = state.activeDeck[game];
  var decks = getDecks(game);
  return decks.filter(function(d){ return d.id===id; })[0] || null;
}
function createDeck(game, name){
  var id = 'd' + Date.now() + Math.floor(Math.random()*1000);
  var deck = game === 'onepiece'
    ? { id:id, name: name || 'New Deck', leader:null, cards:{}, dons:{}, tokens:{} }
    : { id:id, name: name || 'New Deck', cards:{}, resources:{}, tokens:{} };
  state.decks[game].push(deck);
  state.activeDeck[game] = id;
  saveState();
  return deck;
}
function ensureActiveDeck(game){
  if(getDecks(game).length===0) createDeck(game);
  if(!getActiveDeck(game)) state.activeDeck[game] = getDecks(game)[0].id;
  var deck = getActiveDeck(game);
  if(game === 'onepiece') deck.dons = deck.dons || {};
  if(game === 'gundam') deck.resources = deck.resources || {};
  deck.tokens = deck.tokens || {};
  return deck;
}
function changeDeckQty(game, deck, bucket, num, delta){
  var cur = deck[bucket][num] || 0;
  var next = cur + delta;
  if(next < 0) next = 0;
  if(bucket === 'cards' && next > 4) next = 4;
  if(bucket === 'dons' && next > 10) next = 10;
  if(bucket === 'resources' && next > 10) next = 10;
  if(next === 0) delete deck[bucket][num]; else deck[bucket][num] = next;
  saveState();
  if(next > cur){
    var c = (getIndex(game).byNumber[num]||[])[0];
    if(c) cacheImage(c.image_url);
  }
  renderDeckView();
}
function addCardToDeck(game, card){
  var deck = ensureActiveDeck(game);
  if(game === 'onepiece' && card.type === 'Leader'){
    deck.leader = card.number;
    toast(card.name + ' set as leader');
    cacheImage(card.image_url);
  } else if(game === 'onepiece' && isOnePieceDonCard(card)){
    var dcur = deck.dons[card.number] || 0;
    if(dcur >= 10){ toast('DON!! deck is full'); return; }
    deck.dons[card.number] = dcur + 1;
    toast('Added ' + card.name + ' to DON!! deck');
    cacheImage(card.image_url);
  } else if(game === 'gundam' && card.type === 'RESOURCE'){
    deck.resources[card.number] = (deck.resources[card.number]||0) + 1;
    toast('Added ' + card.name + ' to resource deck');
    cacheImage(card.image_url);
  } else if(isTokenCard(card)){
    deck.tokens[card.number] = (deck.tokens[card.number]||0) + 1;
    toast('Added ' + card.name + ' to tokens');
    cacheImage(card.image_url);
  } else {
    var cur = deck.cards[card.number] || 0;
    if(cur >= 4){ toast('Max 4 copies reached'); return; }
    deck.cards[card.number] = cur + 1;
    toast('Added ' + card.name);
    cacheImage(card.image_url);
  }
  saveState();
}
function addCardCopiesToDeck(game, card, count){
  var deck = ensureActiveDeck(game);
  var changed = 0;
  if(game === 'onepiece' && card.type === 'Leader'){
    deck.leader = card.number;
    changed = 1;
  } else if(game === 'onepiece' && isOnePieceDonCard(card)){
    var dcur = deck.dons[card.number] || 0;
    var dnext = Math.max(0, Math.min(10, dcur + count));
    if(dnext === 0) delete deck.dons[card.number]; else deck.dons[card.number] = dnext;
    changed = dnext - dcur;
  } else if(game === 'gundam' && card.type === 'RESOURCE'){
    var rcur = deck.resources[card.number] || 0;
    var rnext = Math.max(0, rcur + count);
    deck.resources[card.number] = rnext;
    if(rnext === 0) delete deck.resources[card.number];
    changed = rnext - rcur;
  } else if(isTokenCard(card)){
    var tcur = deck.tokens[card.number] || 0;
    var tnext = Math.max(0, tcur + count);
    if(tnext === 0) delete deck.tokens[card.number]; else deck.tokens[card.number] = tnext;
    changed = tnext - tcur;
  } else {
    var cur = deck.cards[card.number] || 0;
    var next = Math.max(0, Math.min(4, cur + count));
    if(next === 0) delete deck.cards[card.number]; else deck.cards[card.number] = next;
    changed = next - cur;
  }
  if(changed !== 0){
    if(changed > 0) cacheImage(card.image_url);
    saveState();
    toast((changed > 0 ? 'Added ' : 'Removed ') + Math.abs(changed) + 'x ' + card.name);
  } else if(count > 0) {
    toast(isOnePieceDonCard(card) ? 'DON!! deck is full' : 'Max 4 copies reached');
  } else {
    toast('No copies to remove');
  }
}
function deckLegality(game, deck){
  var idx = getIndex(game);
  var errs = [];
  if(game === 'onepiece'){
    var total = 0; Object.keys(deck.cards).forEach(function(k){ total += deck.cards[k]; });
    var donTotal = 0; Object.keys(deck.dons || {}).forEach(function(k){ donTotal += deck.dons[k]; });
    if(!deck.leader) errs.push('No leader selected');
    if(total !== 50) errs.push('Deck has ' + total + '/50 cards');
    if(donTotal !== 10) errs.push('DON!! deck has ' + donTotal + '/10 cards');
    var overCount = 0; Object.keys(deck.cards).forEach(function(k){ if(deck.cards[k]>4) overCount++; });
    if(overCount) errs.push(overCount + ' card(s) exceed the 4-copy limit');
    if(deck.leader){
      var leaderCard = (idx.byNumber[deck.leader]||[])[0];
      var leaderColors = ((leaderCard && leaderCard.color)||'').split(/[\s,\/]+/).filter(Boolean);
      var mismatched = 0;
      Object.keys(deck.cards).forEach(function(num){
        var cc = (idx.byNumber[num]||[])[0];
        if(!cc) return;
        var ccColors = ((cc.color)||'').split(/[\s,\/]+/).filter(Boolean);
        var match = ccColors.some(function(col){ return leaderColors.indexOf(col) >= 0; });
        if(!match) mismatched++;
      });
      if(mismatched) errs.push(mismatched + ' card(s) do not match leader color');
    }
  } else {
    var mtotal = 0; Object.keys(deck.cards).forEach(function(k){ mtotal += deck.cards[k]; });
    var rtotal = 0; Object.keys(deck.resources).forEach(function(k){ rtotal += deck.resources[k]; });
    if(mtotal !== 50) errs.push('Main deck has ' + mtotal + '/50 cards');
    if(rtotal !== 10) errs.push('Resource deck has ' + rtotal + '/10 cards');
    var over2 = 0; Object.keys(deck.cards).forEach(function(k){ if(deck.cards[k]>4) over2++; });
    if(over2) errs.push(over2 + ' card(s) exceed the 4-copy limit');
  }
  return errs;
}
function cardColors(card){
  return ((card && card.color)||'').split(/[\s,\/]+/).filter(Boolean);
}
function sharesAnyColor(card, colors){
  if(!colors || colors.length === 0) return true;
  var cc = cardColors(card);
  return cc.some(function(col){ return colors.indexOf(col) >= 0; });
}
function isOnePieceDonCard(card){
  return card && (card.type === 'DON!!' || /^don_/i.test(card.id || '') || /^DON!! Card/i.test(card.name || ''));
}
function isTokenCard(card){
  if(!card) return false;
  if(card.type === 'RESOURCE' || isOnePieceDonCard(card)) return false;
  var type = String(card.type || '');
  var num = String(card.number || card.id || '');
  return /TOKEN/i.test(type) || /^EX (BASE|RESOURCE)$/i.test(type) || /^(T|EXB|EXR)-/i.test(num);
}
function quickStepsForCard(game, card){
  if(isOnePieceDonCard(card) || isTokenCard(card) || (game === 'gundam' && card.type === 'RESOURCE')){
    return [-1,-2,-3,-4,-10,1,2,3,4,10];
  }
  return [-1,-2,-3,-4,1,2,3,4];
}
function deckCardEntries(game, deck){
  var idx = getIndex(game);
  return Object.keys(deck.cards || {}).map(function(num){
    return {
      num: num,
      qty: deck.cards[num],
      card: (idx.byNumber[num]||[])[0]
    };
  }).filter(function(e){ return e.card && e.qty > 0; });
}
function numericCurve(entries, field){
  var buckets = {};
  entries.forEach(function(e){
    var v = e.card[field];
    if(v == null || v === '') return;
    var n = parseInt(v, 10);
    if(isNaN(n)) return;
    buckets[n] = (buckets[n] || 0) + e.qty;
  });
  return buckets;
}
function renderCurve(title, buckets){
  var keys = Object.keys(buckets).map(function(k){ return parseInt(k, 10); }).sort(function(a,b){ return a-b; });
  if(keys.length === 0) return '';
  var max = keys.reduce(function(m,k){ return Math.max(m, buckets[k]); }, 1);
  return '<div class="curve-block"><div class="curve-title">' + escapeHtml(title) + '</div>' +
    keys.map(function(k){
      var count = buckets[k];
      var pct = Math.max(6, Math.round((count / max) * 100));
      return '<div class="curve-row"><span class="curve-label">' + k + '</span>' +
        '<div class="curve-track"><div class="curve-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="curve-count">' + count + '</span></div>';
    }).join('') +
  '</div>';
}
function renderDeckStats(game, deck){
  var el = document.getElementById('deck-stats');
  if(!el) return;
  var entries = deckCardEntries(game, deck);
  var total = entries.reduce(function(sum,e){ return sum + e.qty; }, 0);
  if(total === 0){
    el.innerHTML = '<div class="empty">Add cards to see your deck curves.</div>';
    return;
  }
  var costCurve = numericCurve(entries, 'cost');
  var levelCurve = numericCurve(entries, 'level');
  var curves = renderCurve('Cost curve', costCurve) + renderCurve('Level curve', levelCurve);
  el.innerHTML = '<div class="deck-stats-head"><span>' + total + ' card' + (total===1?'':'s') + ' in main deck</span></div>' +
    (curves || '<div class="empty">No numeric cost or level data for this deck.</div>');
}
function deckToText(game, deck){
  var idx = getIndex(game);
  var lines = [];
  lines.push('# ' + deck.name + ' (' + game + ')');
  if(game === 'onepiece' && deck.leader){
    var lc = (idx.byNumber[deck.leader]||[])[0];
    lines.push('Leader: ' + deck.leader + (lc ? ' ' + lc.name : ''));
  }
  Object.keys(deck.cards).sort().forEach(function(num){
    var c = (idx.byNumber[num]||[])[0];
    lines.push(deck.cards[num] + 'x ' + num + (c ? ' ' + c.name : ''));
  });
  if(game === 'onepiece'){
    lines.push('-- DON!! Deck --');
    Object.keys(deck.dons || {}).sort().forEach(function(num){
      var c = (idx.byNumber[num]||[])[0];
      lines.push(deck.dons[num] + 'x ' + num + (c ? ' ' + c.name : ''));
    });
  }
  lines.push('-- Tokens --');
  Object.keys(deck.tokens || {}).sort().forEach(function(num){
    var c = (idx.byNumber[num]||[])[0];
    lines.push(deck.tokens[num] + 'x ' + num + (c ? ' ' + c.name : ''));
  });
  if(game === 'gundam'){
    lines.push('-- Resources --');
    Object.keys(deck.resources).sort().forEach(function(num){
      var c = (idx.byNumber[num]||[])[0];
      lines.push(deck.resources[num] + 'x ' + num + (c ? ' ' + c.name : ''));
    });
  }
  return lines.join('\n');
}
function importDeckText(text){
  var game = currentGame;
  var deck = ensureActiveDeck(game);
  var idx = getIndex(game);
  var added = 0;
  text.split('\n').forEach(function(line){
    var m = line.match(/(\d+)\s*x?\s*([A-Za-z0-9\-]+)/i);
    if(!m) return;
    var qty = parseInt(m[1],10);
    var num = m[2].toUpperCase();
    if(!idx.byNumber[num]) return;
    var card = idx.byNumber[num][0];
    if(game === 'onepiece' && card.type === 'Leader'){ deck.leader = num; }
    else if(game === 'onepiece' && isOnePieceDonCard(card)){ deck.dons[num] = Math.min(qty,10); }
    else if(game === 'gundam' && card.type === 'RESOURCE'){ deck.resources[num] = qty; }
    else if(isTokenCard(card)){ deck.tokens[num] = qty; }
    else { deck.cards[num] = Math.min(qty,4); }
    cacheImage(card.image_url);
    added++;
  });
  saveState();
  renderDeckView();
  toast('Imported ' + added + ' line(s)');
}
function exportDeck(){
  var game = currentGame;
  var deck = getActiveDeck(game);
  if(!deck) return;
  var text = deckToText(game, deck);
  var blob = new Blob([text], {type:'text/plain'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = deck.name.replace(/\s+/g,'_') + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}

// Gather every image that should stay available offline right now:
// anything owned (any qty > 0) or used in any saved deck, across both games.
function getRelevantImageUrls(){
  var urls = {};
  ['onepiece','gundam'].forEach(function(game){
    var idx = getIndex(game);
    Object.keys(state.collection[game]).forEach(function(id){
      var e = state.collection[game][id];
      if(e && e.qty > 0){
        var c = idx.byId[id];
        if(c && c.image_url) urls[c.image_url] = true;
      }
    });
    getDecks(game).forEach(function(deck){
      Object.keys(deck.cards||{}).forEach(function(num){
        var c = (idx.byNumber[num]||[])[0];
        if(c && c.image_url) urls[c.image_url] = true;
      });
      if(deck.resources){
        Object.keys(deck.resources).forEach(function(num){
          var c = (idx.byNumber[num]||[])[0];
          if(c && c.image_url) urls[c.image_url] = true;
        });
      }
      if(game === 'onepiece' && deck.dons){
        Object.keys(deck.dons).forEach(function(num){
          var dc = (idx.byNumber[num]||[])[0];
          if(dc && dc.image_url) urls[dc.image_url] = true;
        });
      }
      if(deck.tokens){
        Object.keys(deck.tokens).forEach(function(num){
          var tc = (idx.byNumber[num]||[])[0];
          if(tc && tc.image_url) urls[tc.image_url] = true;
        });
      }
      if(game === 'onepiece' && deck.leader){
        var lc = (idx.byNumber[deck.leader]||[])[0];
        if(lc && lc.image_url) urls[lc.image_url] = true;
      }
    });
  });
  return Object.keys(urls);
}
function cacheAllRelevantImages(){
  if(!CACHE_SUPPORTED){ toast('Offline image caching needs the app hosted over HTTPS'); return; }
  var urls = getRelevantImageUrls();
  if(urls.length === 0){ toast('Nothing to cache yet'); return; }
  toast('Caching ' + urls.length + ' images...');
  caches.open(IMAGE_CACHE).then(function(cache){
    Promise.all(urls.map(function(u){ return cache.add(u).catch(function(){}); })).then(function(){
      toast('Cached ' + urls.length + ' images for offline use');
      renderCacheStatus();
    });
  });
}
function clearImageCache(){
  if(!CACHE_SUPPORTED) return;
  caches.delete(IMAGE_CACHE).then(function(){ toast('Cleared offline image cache'); renderCacheStatus(); });
}
function renderCacheStatus(){
  var el = document.getElementById('cache-status');
  if(!el) return;
  if(!CACHE_SUPPORTED){
    el.textContent = 'Offline images need HTTPS hosting (see README).';
    return;
  }
  countCachedImages(function(n){
    el.textContent = n + ' card image' + (n===1?'':'s') + ' cached for offline viewing.';
  });
}

// ---------- Rendering: shared card tile ----------
// True lazy loading via IntersectionObserver: only fetch a card image once its
// tile actually scrolls into (near) view. Rendering a filtered list can create
// up to 300 tiles at once, and firing an image request for every one of them
// immediately can look like a burst/DoS to a third-party image host (this is
// what happened to gundam-gcg.com, which started returning 503s under that
// load) even though the same burst is fine against a beefier CDN. Loading
// only what's visible keeps concurrent requests to a small, real number.
var _lazyObserver = null;
function getLazyObserver(){
  if(_lazyObserver) return _lazyObserver;
  if(typeof IntersectionObserver === 'undefined') return null;
  _lazyObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      var el = entry.target;
      _lazyObserver.unobserve(el);
      var url = el.getAttribute('data-lazy-url');
      var name = el.getAttribute('data-lazy-name');
      el.removeAttribute('data-lazy-url');
      el.removeAttribute('data-lazy-name');
      if(!url) return;
      var img = new Image();
      img.alt = name || '';
      img.referrerPolicy = 'no-referrer';
      img.onload = function(){ el.innerHTML=''; el.appendChild(img); };
      img.onerror = function(){ /* offline, unreachable, or rate-limited - keep text fallback */ };
      img.src = url;
    });
  }, { rootMargin: '400px 0px', threshold: 0.01 });
  return _lazyObserver;
}
function lazyLoadImage(el, url, name){
  url = normalizeImageUrl(url);
  if(!url) return;
  var observer = getLazyObserver();
  if(!observer){
    // Fallback for browsers without IntersectionObserver: load immediately.
    var img = new Image();
    img.alt = name || '';
    img.referrerPolicy = 'no-referrer';
    img.onload = function(){ el.innerHTML=''; el.appendChild(img); };
    img.onerror = function(){ /* offline or unreachable - keep text fallback */ };
    img.src = url;
    return;
  }
  el.setAttribute('data-lazy-url', url);
  el.setAttribute('data-lazy-name', name || '');
  observer.observe(el);
}
function unobserveLazyImages(container){
  var observer = _lazyObserver;
  if(!observer || !container) return;
  var els = container.querySelectorAll('[data-lazy-url]');
  for(var i=0; i<els.length; i++){ observer.unobserve(els[i]); }
}
function statTags(c){
  var tags = [];
  if(c.game === 'onepiece'){
    if(c.cost != null && c.cost !== '') tags.push('<span class="tag">Cost ' + escapeHtml(c.cost) + '</span>');
    if(c.power) tags.push('<span class="tag">Power ' + escapeHtml(c.power) + '</span>');
    if(c.life) tags.push('<span class="tag">Life ' + escapeHtml(c.life) + '</span>');
    if(c.counter) tags.push('<span class="tag">Counter ' + escapeHtml(c.counter) + '</span>');
  } else {
    if(c.level != null) tags.push('<span class="tag">Lv ' + escapeHtml(c.level) + '</span>');
    if(c.cost != null) tags.push('<span class="tag">Cost ' + escapeHtml(c.cost) + '</span>');
    if(c.ap != null) tags.push('<span class="tag">AP ' + escapeHtml(c.ap) + '</span>');
    if(c.hp != null) tags.push('<span class="tag">HP ' + escapeHtml(c.hp) + '</span>');
  }
  return tags.join('');
}
function cardTile(c, onClick){
  var div = document.createElement('div');
  div.className = 'card-tile';
  div.style.borderLeftColor = colorToHex(c.color);
  var qty = collectionQty(c.game, c.id);
  div.innerHTML =
    (qty>0 ? '<div class="qty-badge">x' + qty + '</div>' : '') +
    '<div class="thumb">' + escapeHtml(c.name) + '</div>' +
    '<div class="meta">' +
      '<div class="name">' + escapeHtml(c.name) + '</div>' +
      '<div class="sub">' + escapeHtml(c.number||'') + ' &middot; ' + escapeHtml(c.rarity||'') + '</div>' +
    '</div>';
  div.addEventListener('click', function(){ (onClick || openCardModal)(c); });
  lazyLoadImage(div.querySelector('.thumb'), c.image_url, c.name);
  return div;
}

// ---------- Modal ----------
function showModal(){ document.getElementById('modal-overlay').classList.remove('hidden'); }
function closeModal(){ document.getElementById('modal-overlay').classList.add('hidden'); }
function openCardModal(c){
  var idx = getIndex(c.game);
  var modal = document.getElementById('modal');
  var qty = collectionQty(c.game, c.id);
  var price = collectionPrice(c.game, c.id);
  var variants = (idx.byNumber[c.number]||[]).filter(function(v){ return v.id !== c.id; });
  modal.innerHTML =
    '<button class="close-btn" id="modal-close">&times;</button>' +
    '<div class="modal-top">' +
      '<div class="modal-img" id="modal-img">' + escapeHtml(c.name) + '</div>' +
      '<div>' +
        '<h2>' + escapeHtml(c.name) + '</h2>' +
        '<div class="tag-row">' +
          (c.set_code ? '<span class="tag">' + escapeHtml(c.set_code) + '</span>' : '') +
          (c.rarity ? '<span class="tag">' + escapeHtml(c.rarity) + '</span>' : '') +
          (c.type ? '<span class="tag">' + escapeHtml(c.type) + '</span>' : '') +
          (c.color ? '<span class="tag">' + escapeHtml(c.color) + '</span>' : '') +
        '</div>' +
        '<div class="tag-row">' + statTags(c) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="text-block">' + escapeHtml(c.text||'') + '</div>' +
    '<div class="action-row">' +
      '<div><label class="small">Owned (this printing)</label><div class="stepper">' +
        '<button id="qty-minus">-</button><span id="qty-val">' + qty + '</span><button id="qty-plus">+</button>' +
      '</div></div>' +
      '<div><label class="small">Price ($)</label>' +
        '<input class="price-input" id="price-input" type="number" step="0.01" min="0" value="' + (price!=null?price:'') + '" placeholder="0.00"></div>' +
      '<div><label class="small">&nbsp;</label><button class="text-btn" id="add-to-deck-btn">Add to active deck</button></div>' +
    '</div>' +
    (variants.length ? (
      '<h3 class="section-label">Other printings (' + variants.length + ')</h3>' +
      '<div class="printing-list" id="printing-list"></div>'
    ) : '');
  lazyLoadImage(document.getElementById('modal-img'), c.image_url, c.name);
  showModal();
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('qty-minus').onclick = function(){
    setCollectionQty(c.game, c.id, collectionQty(c.game,c.id)-1);
    document.getElementById('qty-val').textContent = collectionQty(c.game,c.id);
    renderBrowse();
  };
  document.getElementById('qty-plus').onclick = function(){
    setCollectionQty(c.game, c.id, collectionQty(c.game,c.id)+1);
    document.getElementById('qty-val').textContent = collectionQty(c.game,c.id);
    renderBrowse();
  };
  document.getElementById('price-input').onchange = function(e){
    setCollectionPrice(c.game, c.id, parseFloat(e.target.value));
  };
  document.getElementById('add-to-deck-btn').onclick = function(){
    addCardToDeck(c.game, c);
    if(currentTab === 'deck') renderDeckView();
  };
  if(variants.length){
    var listEl = document.getElementById('printing-list');
    variants.forEach(function(v){
      var row = document.createElement('div');
      row.className = 'printing-row';
      var vQty = collectionQty(v.game, v.id);
      row.innerHTML =
        '<div class="p-thumb"></div>' +
        '<div class="p-meta"><div class="p-name">' + escapeHtml(v.rarity||'') + '</div><div class="dsub">' + escapeHtml(v.id) + '</div></div>' +
        '<div class="stepper"><button data-act="minus">-</button><span class="p-qty">' + vQty + '</span><button data-act="plus">+</button></div>';
      lazyLoadImage(row.querySelector('.p-thumb'), v.image_url, v.name);
      row.querySelector('[data-act="minus"]').onclick = function(){
        setCollectionQty(v.game, v.id, collectionQty(v.game, v.id) - 1);
        row.querySelector('.p-qty').textContent = collectionQty(v.game, v.id);
        renderBrowse();
      };
      row.querySelector('[data-act="plus"]').onclick = function(){
        setCollectionQty(v.game, v.id, collectionQty(v.game, v.id) + 1);
        row.querySelector('.p-qty').textContent = collectionQty(v.game, v.id);
        renderBrowse();
      };
      listEl.appendChild(row);
    });
  }
}
function openImportModal(){
  var modal = document.getElementById('modal');
  modal.innerHTML =
    '<button class="close-btn" id="modal-close">&times;</button>' +
    '<h2>Import deck list</h2>' +
    '<p style="font-size:12.5px;color:var(--text-dim)">Paste lines like "4x OP01-016" or "2x GD01-010" — one card per line.</p>' +
    '<textarea id="import-text" style="width:100%;height:160px;background:var(--bg-elev-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;"></textarea>' +
    '<div class="action-row"><button class="text-btn" id="import-submit">Import</button></div>';
  showModal();
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('import-submit').onclick = function(){
    importDeckText(document.getElementById('import-text').value);
    closeModal();
  };
}

// ---------- Toast ----------
var toastTimer;
function toast(msg){
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.add('hidden'); }, 1800);
}

// ---------- Browse view ----------
function fillSelect(id, options){
  var el = document.getElementById(id);
  var current = el.value;
  el.innerHTML = '<option value="">All</option>' + options.map(function(o){
    return '<option value="' + escapeAttr(o.value) + '">' + escapeHtml(o.label) + '</option>';
  }).join('');
  if(options.some(function(o){ return o.value === current; })) el.value = current;
}
function renderFilterOptions(){
  var idx = getIndex(currentGame);
  fillSelect('filter-set', idx.sets.map(function(s){ return {value:s, label: s + (idx.setNames[s] ? ' - ' + idx.setNames[s] : '')}; }));
  fillSelect('filter-color', idx.colors.map(function(c){ return {value:c, label:c}; }));
  fillSelect('filter-type', idx.types.map(function(t){ return {value:t, label:t}; }));
  fillSelect('filter-rarity', idx.rarities.map(function(r){ return {value:r, label:r}; }));
}
function matchesFilters(c){
  if(filters.set && c.set_code !== filters.set) return false;
  if(filters.color && (c.color||'').indexOf(filters.color) === -1) return false;
  if(filters.type && c.type !== filters.type) return false;
  if(filters.rarity && c.rarity !== filters.rarity) return false;
  if(filters.search){
    var s = filters.search.toLowerCase();
    var hay = ((c.name||'') + ' ' + (c.text||'') + ' ' + (c.number||'')).toLowerCase();
    if(hay.indexOf(s) === -1) return false;
  }
  return true;
}
function sortCards(list){
  var arr = list.slice();
  if(filters.sort === 'name') arr.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  else if(filters.sort === 'cost') arr.sort(function(a,b){ return numOrInf(a.cost) - numOrInf(b.cost); });
  else arr.sort(function(a,b){
    var s = (a.set_code||'').localeCompare(b.set_code||'');
    if(s !== 0) return s;
    return (a.number||'').localeCompare(b.number||'', undefined, {numeric:true});
  });
  return arr;
}
function renderBrowse(){
  var idx = getIndex(currentGame);
  var filtered = sortCards(idx.canonical.filter(matchesFilters));
  document.getElementById('result-count').textContent = filtered.length + ' card' + (filtered.length===1?'':'s') + ' (alt arts shown on tap)';
  var grid = document.getElementById('card-grid');
  unobserveLazyImages(grid);
  grid.innerHTML = '';
  if(filtered.length === 0){
    grid.innerHTML = '<div class="empty-state">No cards match your filters.</div>';
    return;
  }
  var frag = document.createDocumentFragment();
  filtered.slice(0,300).forEach(function(c){ frag.appendChild(cardTile(c)); });
  grid.appendChild(frag);
  if(filtered.length > 300){
    var note = document.createElement('div');
    note.className = 'result-count';
    note.style.gridColumn = '1/-1';
    note.textContent = 'Showing first 300 of ' + filtered.length + '. Narrow your search to see more.';
    grid.appendChild(note);
  }
}

// ---------- Deck view ----------
function renderDeckView(){
  var game = currentGame;
  var decks = getDecks(game);
  var select = document.getElementById('deck-select');
  if(decks.length === 0){
    select.innerHTML = '<option value="">No decks yet</option>';
  } else {
    select.innerHTML = decks.map(function(d){ return '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'; }).join('');
  }
  var deck = ensureActiveDeck(game);
  select.value = deck.id;

  var idx = getIndex(game);
  var errs = deckLegality(game, deck);
  var legEl = document.getElementById('deck-legality');
  if(errs.length === 0){ legEl.className = 'legality ok'; legEl.textContent = 'Deck is legal and ready to play.'; }
  else { legEl.className = 'legality warn'; legEl.textContent = errs.join(' · '); }
  renderDeckStats(game, deck);

  var leaderSlot = document.getElementById('deck-leader-slot');
  var resourceSection = document.getElementById('deck-resource-section');
  var donSection = document.getElementById('deck-don-section');
  if(game === 'onepiece'){
    leaderSlot.style.display = 'block';
    donSection.classList.remove('hidden');
    resourceSection.classList.add('hidden');
    if(deck.leader){
      var lc = (idx.byNumber[deck.leader]||[])[0];
      leaderSlot.innerHTML = '<div class="deck-row"><div class="dname">Leader: ' + escapeHtml(lc?lc.name:deck.leader) + '</div><button class="text-btn" id="leader-clear">Change</button></div>';
      document.getElementById('leader-clear').onclick = function(){ deck.leader = null; saveState(); renderDeckView(); };
    } else {
      leaderSlot.innerHTML = '<div class="empty">No leader selected. Search leaders below and tap one to set it.</div>';
    }
  } else {
    leaderSlot.style.display = 'none';
    donSection.classList.add('hidden');
    resourceSection.classList.remove('hidden');
  }

  var listEl = document.getElementById('deck-list');
  var entries = Object.keys(deck.cards).map(function(k){ return [k, deck.cards[k]]; });
  document.getElementById('deck-count').textContent = entries.reduce(function(a,e){ return a+e[1]; },0);
  listEl.innerHTML = '';
  if(entries.length === 0){
    listEl.innerHTML = '<div class="empty-state">No cards added yet.</div>';
  } else {
    entries.sort(function(a,b){ return a[0].localeCompare(b[0], undefined, {numeric:true}); });
    entries.forEach(function(e){
      var num = e[0], qty = e[1];
      var c = (idx.byNumber[num]||[])[0];
      var row = document.createElement('div');
      row.className = 'deck-row';
      row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div></div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button></div>';
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c.image_url, c.name);
      if(c) row.addEventListener('click', function(){ openCardModal(c); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'cards', num, -1); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'cards', num, 1); };
      listEl.appendChild(row);
    });
  }

  if(game === 'gundam'){
    var resList = document.getElementById('resource-list');
    var rEntries = Object.keys(deck.resources).map(function(k){ return [k, deck.resources[k]]; });
    document.getElementById('resource-count').textContent = rEntries.reduce(function(a,e){ return a+e[1]; },0);
    resList.innerHTML = '';
    rEntries.forEach(function(e){
      var num = e[0], qty = e[1];
      var c = (idx.byNumber[num]||[])[0];
      var row = document.createElement('div');
      row.className = 'deck-row';
      row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div></div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button><button data-act="plus10">+10</button></div>';
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c.image_url, c.name);
      if(c) row.addEventListener('click', function(){ openCardModal(c); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, -1); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, 1); };
      row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, 10); };
      resList.appendChild(row);
    });
  }
  if(game === 'onepiece'){
    var donList = document.getElementById('don-list');
    var dEntries = Object.keys(deck.dons || {}).map(function(k){ return [k, deck.dons[k]]; });
    document.getElementById('don-count').textContent = dEntries.reduce(function(a,e){ return a+e[1]; },0);
    donList.innerHTML = '';
    if(dEntries.length === 0){
      donList.innerHTML = '<div class="empty-state">No DON!! cards added yet.</div>';
    }
    dEntries.sort(function(a,b){ return a[0].localeCompare(b[0], undefined, {numeric:true}); });
    dEntries.forEach(function(e){
      var num = e[0], qty = e[1];
      var c = (idx.byNumber[num]||[])[0];
      var row = document.createElement('div');
      row.className = 'deck-row';
      row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div></div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button><button data-act="plus10">+10</button></div>';
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c.image_url, c.name);
      if(c) row.addEventListener('click', function(){ openCardModal(c); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'dons', num, -1); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'dons', num, 1); };
      row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'dons', num, 10); };
      donList.appendChild(row);
    });
  }
  var tokenList = document.getElementById('token-list');
  var tokenEntries = Object.keys(deck.tokens || {}).map(function(k){ return [k, deck.tokens[k]]; });
  document.getElementById('token-count').textContent = tokenEntries.reduce(function(a,e){ return a+e[1]; },0);
  tokenList.innerHTML = '';
  if(tokenEntries.length === 0){
    tokenList.innerHTML = '<div class="empty-state">No tokens added yet.</div>';
  }
  tokenEntries.sort(function(a,b){ return a[0].localeCompare(b[0], undefined, {numeric:true}); });
  tokenEntries.forEach(function(e){
    var num = e[0], qty = e[1];
    var c = (idx.byNumber[num]||[])[0];
    var row = document.createElement('div');
    row.className = 'deck-row';
    row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div></div>' +
      '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button><button data-act="plus10">+10</button></div>';
    if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c.image_url, c.name);
    if(c) row.addEventListener('click', function(){ openCardModal(c); });
    row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, -1); };
    row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, 1); };
    row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, 10); };
    tokenList.appendChild(row);
  });

  renderDeckAddGrid();
}
function renderDeckAddGrid(){
  var game = currentGame;
  var idx = getIndex(game);
  var deck = ensureActiveDeck(game);
  var grid = document.getElementById('deck-add-grid');
  var colorToggle = document.getElementById('deck-color-toggle');
  var list = idx.canonical;
  if(game === 'onepiece'){
    if(deck.leader){
      var leaderCard = (idx.byNumber[deck.leader]||[])[0];
      var leaderColors = cardColors(leaderCard);
      colorToggle.classList.remove('hidden');
      colorToggle.textContent = onePieceAllowAnyColor ? 'Any color: On' : 'Leader colors only';
      colorToggle.classList.toggle('active', onePieceAllowAnyColor);
      list = list.filter(function(c){
        return c.type !== 'Leader' && (isOnePieceDonCard(c) || isTokenCard(c) || onePieceAllowAnyColor || sharesAnyColor(c, leaderColors));
      });
    } else {
      colorToggle.classList.add('hidden');
      list = list.filter(function(c){ return c.type === 'Leader' || isOnePieceDonCard(c) || isTokenCard(c); });
    }
  } else {
    colorToggle.classList.add('hidden');
  }
  if(deckSearchTerm){
    var s = deckSearchTerm.toLowerCase();
    list = list.filter(function(c){ return ((c.name||'')+' '+(c.number||'')).toLowerCase().indexOf(s) !== -1; });
  }
  list = list.slice(0,60);
  grid.innerHTML = '';
  list.forEach(function(c){
    if(game === 'onepiece' && !deck.leader && c.type === 'Leader'){
      grid.appendChild(cardTile(c, function(card){
        addCardToDeck(game, card);
        renderDeckView();
      }));
    } else {
      grid.appendChild(deckAddTile(c, game));
    }
  });
  if(list.length === 0) grid.innerHTML = '<div class="empty-state">No matches.</div>';
}
function deckAddTile(c, game){
  var tile = cardTile(c, openCardModal);
  var quick = document.createElement('div');
  quick.className = 'quick-add';
  quickStepsForCard(game, c).forEach(function(n){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = (n > 0 ? '+' : '') + n;
    if(n < 0) btn.className = 'remove';
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      addCardCopiesToDeck(game, c, n);
      renderDeckView();
    });
    quick.appendChild(btn);
  });
  tile.appendChild(quick);
  return tile;
}

// ---------- Collection / trade binder view ----------
function renderCollectionView(){
  var game = currentGame;
  var idx = getIndex(game);
  var search = (document.getElementById('collection-search').value||'').toLowerCase();
  var deckSel = document.getElementById('collection-deck-filter');
  var decks = getDecks(game);
  var prevVal = deckSel.value;
  deckSel.innerHTML = '<option value="">Trade binder (every printing you own)</option>' + decks.map(function(d){
    return '<option value="' + d.id + '">Needed for: ' + escapeHtml(d.name) + '</option>';
  }).join('');
  deckSel.value = prevVal;
  var deckFilterId = deckSel.value;

  var list = document.getElementById('collection-list');
  unobserveLazyImages(list);
  list.innerHTML = '';

  if(deckFilterId){
    var deck = decks.filter(function(d){ return d.id === deckFilterId; })[0];
    var need = {};
    if(deck){
      Object.keys(deck.cards).forEach(function(n){ need[n] = (need[n]||0) + deck.cards[n]; });
      if(game === 'gundam') Object.keys(deck.resources).forEach(function(n){ need[n] = (need[n]||0) + deck.resources[n]; });
      if(game === 'onepiece' && deck.dons) Object.keys(deck.dons).forEach(function(n){ need[n] = (need[n]||0) + deck.dons[n]; });
      if(deck.tokens) Object.keys(deck.tokens).forEach(function(n){ need[n] = (need[n]||0) + deck.tokens[n]; });
      if(game === 'onepiece' && deck.leader) need[deck.leader] = (need[deck.leader]||0) + 1;
    }
    var rows = Object.keys(need).map(function(num){
      var c = (idx.byNumber[num]||[])[0];
      var owned = ownedQtyByNumber(game, num);
      var needQty = need[num];
      return { card:c, num:num, owned:owned, needQty:needQty, missing: Math.max(0, needQty-owned) };
    });
    if(search) rows = rows.filter(function(r){ return ((r.card&&r.card.name)||'').toLowerCase().indexOf(search) !== -1; });
    rows.sort(function(a,b){ return ((a.card&&a.card.name)||'').localeCompare((b.card&&b.card.name)||''); });

    renderCollectionSummary(game, idx);
    if(rows.length === 0){ list.innerHTML = '<div class="empty-state">This deck has no cards yet.</div>'; return; }
    rows.forEach(function(r){
      var row = document.createElement('div');
      row.className = 'collection-row';
      var badge = ' <span class="dsub">(' + r.owned + '/' + r.needQty + ')</span>';
      var missing = r.missing > 0 ? '<span class="missing-badge">need ' + r.missing + '</span>' : '';
      row.innerHTML =
        '<div class="cthumb"></div>' +
        '<div class="cname">' + escapeHtml(r.card?r.card.name:r.num) + badge + missing + '</div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + r.owned + '</span><button data-act="plus">+</button></div>';
      if(r.card) lazyLoadImage(row.querySelector('.cthumb'), r.card.image_url, r.card.name);
      row.querySelector('[data-act="minus"]').onclick = function(){ adjustOwnedByNumber(game, r.num, -1); renderCollectionView(); };
      row.querySelector('[data-act="plus"]').onclick = function(){ adjustOwnedByNumber(game, r.num, 1); renderCollectionView(); };
      list.appendChild(row);
    });
  } else {
    // Trade binder: every distinct printing owned, shown separately (alt arts included).
    var binderRows = idx.cards.filter(function(c){ return collectionQty(game, c.id) > 0; });
    if(search) binderRows = binderRows.filter(function(c){ return (c.name||'').toLowerCase().indexOf(search) !== -1; });
    binderRows.sort(function(a,b){
      var n = (a.name||'').localeCompare(b.name||'');
      if(n !== 0) return n;
      return (a.id||'').localeCompare(b.id||'', undefined, {numeric:true});
    });

    renderCollectionSummary(game, idx);
    if(binderRows.length === 0){
      list.innerHTML = '<div class="empty-state">Nothing in your trade binder yet. Add cards from the Cards tab — every alt-art printing is tracked separately.</div>';
      return;
    }
    binderRows.forEach(function(c){
      var owned = collectionQty(game, c.id);
      var row = document.createElement('div');
      row.className = 'collection-row';
      row.innerHTML =
        '<div class="cthumb"></div>' +
        '<div class="cname">' + escapeHtml(c.name) + ' <span class="dsub">' + escapeHtml(c.rarity||'') + ' &middot; ' + escapeHtml(c.id) + '</span></div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + owned + '</span><button data-act="plus">+</button></div>';
      lazyLoadImage(row.querySelector('.cthumb'), c.image_url, c.name);
      row.querySelector('[data-act="minus"]').onclick = function(){ setCollectionQty(game, c.id, collectionQty(game,c.id)-1); renderCollectionView(); };
      row.querySelector('[data-act="plus"]').onclick = function(){ setCollectionQty(game, c.id, collectionQty(game,c.id)+1); renderCollectionView(); };
      list.appendChild(row);
    });
  }
  renderCacheStatus();
}
function renderCollectionSummary(game, idx){
  var totalOwned = 0, uniqueOwned = 0, totalValue = 0;
  idx.cards.forEach(function(c){
    var e = state.collection[game][c.id];
    if(e && e.qty){
      totalOwned += e.qty;
      uniqueOwned++;
      if(e.price) totalValue += e.qty * e.price;
    }
  });
  document.getElementById('collection-summary').innerHTML =
    '<div class="summary-stat"><div class="val">' + totalOwned + '</div><div class="lbl">Cards owned</div></div>' +
    '<div class="summary-stat"><div class="val">$' + totalValue.toFixed(2) + '</div><div class="lbl">Estimated value</div></div>' +
    '<div class="summary-stat"><div class="val">' + uniqueOwned + '</div><div class="lbl">Distinct printings</div></div>';
}

// ---------- View switching ----------
function renderCurrentView(){
  if(currentTab === 'browse') renderBrowse();
  else if(currentTab === 'deck') renderDeckView();
  else if(currentTab === 'collection') renderCollectionView();
}

// ---------- Event wiring ----------
document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    document.getElementById('view-' + currentTab).classList.add('active');
    renderCurrentView();
  });
});
document.querySelectorAll('.game-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.game-btn').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    currentGame = btn.dataset.game;
    filters = { search:'', set:'', color:'', type:'', rarity:'', sort:'set' };
    document.getElementById('search-input').value = '';
    renderFilterOptions();
    renderCurrentView();
  });
});
var searchDebounce;
document.getElementById('search-input').addEventListener('input', function(e){
  filters.search = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderBrowse, 150);
});
['filter-set','filter-color','filter-type','filter-rarity','filter-sort'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(e){
    filters[id.replace('filter-','')] = e.target.value;
    renderBrowse();
  });
});
document.getElementById('filter-toggle').addEventListener('click', function(){
  document.getElementById('filter-panel').classList.toggle('hidden');
});
document.getElementById('filter-clear').addEventListener('click', function(){
  var s = filters.search;
  filters = { search:s, set:'', color:'', type:'', rarity:'', sort:'set' };
  ['filter-set','filter-color','filter-type','filter-rarity'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('filter-sort').value = 'set';
  renderBrowse();
});
document.getElementById('deck-search').addEventListener('input', function(e){
  deckSearchTerm = e.target.value;
  renderDeckAddGrid();
});
document.getElementById('deck-color-toggle').addEventListener('click', function(){
  onePieceAllowAnyColor = !onePieceAllowAnyColor;
  renderDeckAddGrid();
});
document.getElementById('deck-new').addEventListener('click', function(){
  var name = prompt('Deck name?', 'New Deck');
  if(name === null) return;
  createDeck(currentGame, name);
  renderDeckView();
});
document.getElementById('deck-rename').addEventListener('click', function(){
  var deck = getActiveDeck(currentGame);
  if(!deck) return;
  var name = prompt('Rename deck', deck.name);
  if(name){ deck.name = name; saveState(); renderDeckView(); }
});
document.getElementById('deck-delete').addEventListener('click', function(){
  var game = currentGame;
  var deck = getActiveDeck(game);
  if(!deck) return;
  if(!confirm('Delete "' + deck.name + '"?')) return;
  state.decks[game] = state.decks[game].filter(function(d){ return d.id !== deck.id; });
  state.activeDeck[game] = state.decks[game][0] ? state.decks[game][0].id : null;
  saveState();
  renderDeckView();
});
document.getElementById('deck-select').addEventListener('change', function(e){
  state.activeDeck[currentGame] = e.target.value;
  saveState();
  renderDeckView();
});
document.getElementById('deck-export').addEventListener('click', exportDeck);
document.getElementById('deck-import').addEventListener('click', openImportModal);
document.getElementById('deck-clear').addEventListener('click', function(){
  var game = currentGame;
  var deck = getActiveDeck(game);
  if(!deck) return;
  var msg = game === 'onepiece'
    ? 'Clear all main deck and DON!! cards from "' + deck.name + '"? Your leader will stay selected.'
    : 'Clear all cards and resources from "' + deck.name + '"?';
  if(!confirm(msg)) return;
  deck.cards = {};
  if(game === 'onepiece') deck.dons = {};
  if(game === 'gundam') deck.resources = {};
  deck.tokens = {};
  saveState();
  renderDeckView();
});
document.getElementById('collection-search').addEventListener('input', renderCollectionView);
document.getElementById('collection-deck-filter').addEventListener('change', renderCollectionView);
document.getElementById('cache-all-btn').addEventListener('click', cacheAllRelevantImages);
document.getElementById('cache-clear-btn').addEventListener('click', clearImageCache);
document.getElementById('modal-overlay').addEventListener('click', function(e){
  if(e.target.id === 'modal-overlay') closeModal();
});

// ---------- Boot ----------
function init(){
  renderFilterOptions();
  renderCurrentView();
  hydrateRemoteCards();
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  }
}
init();

})();
