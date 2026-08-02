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
function searchText(v){
  return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// OAuth Web Client IDs are public by design; do not put API keys, client
// secrets, or tokens in this app. A locally saved ID wins over google-config.js.
var GOOGLE_CLIENT_STORAGE_KEY = 'tcgvault_google_client_id';
function getStoredGoogleClientId(){
  try { return (localStorage.getItem(GOOGLE_CLIENT_STORAGE_KEY) || '').trim(); }
  catch(e){ return ''; }
}
var GOOGLE_CLIENT_ID = getStoredGoogleClientId() || window.TCG_VAULT_GOOGLE_CLIENT_ID || '';
var GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
var SYNC_FILE_NAME = 'tcg-vault-sync.json';

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
    activeDeck: { onepiece:null, gundam:null },
    sync: { auto:false, updatedAt:new Date().toISOString(), lastSyncAt:null }
  };
}
var state;
try {
  state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState();
} catch(e) { state = defaultState(); }
state.collection = state.collection || { onepiece:{}, gundam:{} };
state.decks = state.decks || { onepiece:[], gundam:[] };
state.activeDeck = state.activeDeck || { onepiece:null, gundam:null };
state.sync = state.sync || {};
state.sync.auto = !!state.sync.auto;
state.sync.updatedAt = state.sync.updatedAt || new Date().toISOString();
state.sync.lastSyncAt = state.sync.lastSyncAt || null;
state.decks.onepiece = state.decks.onepiece || [];
state.decks.gundam = state.decks.gundam || [];
state.decks.onepiece.forEach(function(deck){ deck.dons = deck.dons || {}; deck.tokens = deck.tokens || {}; });
state.decks.gundam.forEach(function(deck){
  deck.resources = deck.resources || {};
  deck.exResources = deck.exResources || {};
  deck.exBases = deck.exBases || {};
  deck.tokens = deck.tokens || {};
  deck.allowExtraColors = !!deck.allowExtraColors;
});

function normalizeLoadedState(next){
  next = next || defaultState();
  next.collection = next.collection || { onepiece:{}, gundam:{} };
  next.collection.onepiece = next.collection.onepiece || {};
  next.collection.gundam = next.collection.gundam || {};
  next.decks = next.decks || { onepiece:[], gundam:[] };
  next.decks.onepiece = next.decks.onepiece || [];
  next.decks.gundam = next.decks.gundam || [];
  next.activeDeck = next.activeDeck || { onepiece:null, gundam:null };
  next.sync = next.sync || {};
  next.sync.auto = !!next.sync.auto;
  next.sync.updatedAt = next.sync.updatedAt || new Date().toISOString();
  next.sync.lastSyncAt = next.sync.lastSyncAt || null;
  next.decks.onepiece.forEach(function(deck){ deck.dons = deck.dons || {}; deck.tokens = deck.tokens || {}; });
  next.decks.gundam.forEach(function(deck){
    deck.resources = deck.resources || {};
    deck.exResources = deck.exResources || {};
    deck.exBases = deck.exBases || {};
    deck.tokens = deck.tokens || {};
    deck.allowExtraColors = !!deck.allowExtraColors;
  });
  return next;
}
state = normalizeLoadedState(state);

function saveState(options){
  options = options || {};
  if(!options.skipUpdatedAt && state.sync) state.sync.updatedAt = new Date().toISOString();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ /* storage full or unavailable */ }
  if(!options.skipSync) scheduleAutoSync();
  renderSyncStatus();
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
  var existing = {};
  target.forEach(function(c){ if(c && c.id) existing[c.id] = c; });
  var added = 0;
  incoming.forEach(function(c){
    if(!c || !c.id) return;
    if(game === 'gundam') c = sanitizeGundamCard(c);
    if(existing[c.id]){
      var preferIncomingArt = game === 'gundam' && /^(EXB|EXBP|EXR|EXRP)-/i.test(c.id);
      if(c.image_url && (!existing[c.id].image_url || preferIncomingArt)) existing[c.id].image_url = c.image_url;
      if(c.image_candidates){
        existing[c.id].image_candidates = preferIncomingArt
          ? c.image_candidates.concat(imageUrlsForCard(existing[c.id]))
          : imageUrlsForCard(existing[c.id]).concat(c.image_candidates);
      }
      return;
    }
    target.push(c);
    existing[c.id] = c;
    added++;
  });
  if(added) invalidateIndex(game);
  return added;
}
function gundamExResourceHasKnownFrontArt(id){
  id = String(id || '').toUpperCase();
  return !!GUNDAM_CARDLIST_IMAGE_IDS[id] || /^EXRP-00[12]$/.test(id);
}
function sanitizeGundamCard(card){
  var copy = card;
  var id = String(card.id || card.number || '').toUpperCase();
  var type = String(card.type || '').toUpperCase();
  if(type !== 'EX RESOURCE' || gundamExResourceHasKnownFrontArt(id)) return copy;
  copy = Object.assign({}, card);
  copy.image_url = '';
  copy.image_candidates = [];
  return copy;
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
function fetchText(url){
  return fetch(url, { cache: 'no-store' }).then(function(resp){
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  });
}
function optcgImageUrl(imageId){
  if(!imageId) return null;
  var s = String(imageId);
  if(/^https?:\/\//i.test(s)) return s;
  return 'https://optcgapi.com/media/static/Card_Images/' + s.replace(/\.(jpg|png|webp)$/i, '') + '.jpg';
}
function optcgReadableImageUrl(label){
  if(!label) return null;
  var slug = String(label).replace(/'/g, '').replace(/!!/g, '').replace(/\/+/g, ' ');
  slug = slug.replace(/[()]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
  if(!slug) return null;
  return 'https://optcgapi.com/media/static/Card_Images/' + slug + '_img.jpg';
}
function normalizeOnePieceDon(raw, pos){
  var id = firstPresent(raw, ['id','card_id','cardID','don_id','donID','image_id','imageID','imageId']);
  var imageId = firstPresent(raw, ['image_id','imageID','imageId']);
  var directImage = firstPresent(raw, ['card_image','cardImage','image_url','imageUrl','image','img']);
  var name = firstPresent(raw, ['name','card_name','cardName','don_name','donName']) || 'DON!! Card';
  var fullName = firstPresent(raw, ['full_name','fullName','don_full_name','donFullName','display_name','displayName']);
  var setName = firstPresent(raw, ['set_name','setName','deck_name','deckName','product_name','productName']);
  var setCode = firstPresent(raw, ['set_code','setCode','set_id','setId','deck_id','deckId']);
  var number = firstPresent(raw, ['number','card_number','cardNumber']);
  if(!id) id = imageId || number || ('don_' + (pos + 1));
  if(!number) number = String(id).toUpperCase().indexOf('DON') === 0 ? id : String(id);
  var primaryImage = optcgImageUrl(directImage || imageId || id);
  var candidates = [primaryImage, optcgReadableImageUrl(fullName || name)].filter(Boolean);
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
    image_url: primaryImage,
    image_candidates: candidates,
    price: firstPresent(raw, ['market_price','marketPrice','price','inventory_price','inventoryPrice'])
  };
}
function normalizeGundamCard(raw){
  var id = firstPresent(raw, ['product_id','id']);
  var num = firstPresent(raw, ['card_number','number']) || id;
  var traits = raw.traits || raw.trait || '';
  var links = raw.link_refs || raw.link || '';
  var image = normalizeImageUrl(firstPresent(raw, ['image_url']));
  var imageCandidates = [image];
  if(id){
    imageCandidates.push('https://www.gundam-gcg.com/en/images/cards/card/' + id + '.webp?260715=');
    imageCandidates.push('https://www.gundam-gcg.com/jp/images/cards/card/' + id + '.webp?260715=');
  }
  if(num && num !== id){
    imageCandidates.push('https://www.gundam-gcg.com/en/images/cards/card/' + num + '.webp?260715=');
    imageCandidates.push('https://www.gundam-gcg.com/jp/images/cards/card/' + num + '.webp?260715=');
  }
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
    image_url: image,
    image_candidates: imageCandidates.filter(Boolean),
    price: null
  };
}
function fetchGundamCardsByType(type){
  return fetchJson('https://api.gcgapi.com/v1/cards?card_type=' + encodeURIComponent(type) + '&limit=250').then(function(payload){
    var cards = parseEnvelope(payload).map(normalizeGundamCard);
    return mergeCards('gundam', cards);
  }).catch(function(){ return 0; });
}
function fetchGundamBulkCards(){
  return fetchText('https://api.gcgapi.com/v1/bulk').then(function(text){
    var rows = [];
    text = String(text || '').trim();
    if(!text) return 0;
    if(text.charAt(0) === '['){
      rows = JSON.parse(text);
    } else if(text.charAt(0) === '{'){
      var parsed = JSON.parse(text);
      rows = parseEnvelope(parsed);
    } else {
      rows = text.split(/\r?\n/).filter(Boolean).map(function(line){ return JSON.parse(line); });
    }
    return mergeCards('gundam', rows.map(normalizeGundamCard));
  }).catch(function(){ return 0; });
}
function hydrateRemoteCards(){
  var tasks = [];
  tasks.push(fetchJson('https://www.optcgapi.com/api/allDonCards/').then(function(payload){
    var cards = parseEnvelope(payload).map(normalizeOnePieceDon).filter(function(c){ return c.image_url; });
    return mergeCards('onepiece', cards);
  }).catch(function(){ return 0; }));

  tasks.push(fetchGundamBulkCards());
  ['ST01','ST02','ST03','ST04','ST05','ST06','ST07','ST08','ST09','ST10'].forEach(function(setCode){
    tasks.push(fetchJson('https://api.gcgapi.com/v1/sets/' + setCode + '/cards').then(function(payload){
      var cards = parseEnvelope(payload).map(normalizeGundamCard);
      return mergeCards('gundam', cards);
    }).catch(function(){ return 0; }));
  });
  ['EX RESOURCE','EX BASE','UNIT TOKEN'].forEach(function(type){
    tasks.push(fetchGundamCardsByType(type));
  });

  Promise.all(tasks).then(function(results){
    var total = results.reduce(function(a,b){ return a + b; }, 0);
    if(!total) return;
    renderFilterOptions();
    renderCurrentView();
  });
}
function officialGundamImageCandidates(id){
  id = String(id || '').toUpperCase();
  var cardListId = GUNDAM_CARDLIST_IMAGE_IDS[String(id || '').toUpperCase()];
  var scrydexIds = [];
  if(/^EXRP-/i.test(id) || /^EXB/i.test(id)){
    // Scrydex currently has real front images for EXRP-001/002 only. Other
    // token image URLs can resolve to a generic card back, which looks like
    // loaded art to the browser and stops the fallback chain too early.
    if(/^EXRP-001$/i.test(id)) scrydexIds.push('BETA-EXRP-001', 'EXRP-001');
    if(/^EXRP-002$/i.test(id)) scrydexIds.push('EXRP-002');
  } else {
    scrydexIds.push(id);
    if(/_p\d+$/i.test(id)){
      scrydexIds.push(id.replace(/_p\d+$/i, ''));
    }
    scrydexIds.push(id + 'A');
    scrydexIds.push('BETA-' + id);
    scrydexIds.push('BETA-' + id + 'A');
  }
  var scrydexUrls = [];
  scrydexIds.forEach(function(scrydexId){
    scrydexUrls.push('https://images.scrydex.com/gundam/' + scrydexId + '/large');
    scrydexUrls.push('https://images.scrydex.com/gundam/' + scrydexId + '/medium');
  });
  var cardListUrls = cardListId ? ['https://static.gundamcardlist.com/images/cards/' + cardListId + '.jpg'] : [];
  var specialUrls = GUNDAM_SPECIAL_IMAGE_URLS[id] || [];
  var cardGameSearcherId = id.replace(/_P(\d+)$/, '_p$1');
  var cardGameSearcherUrls = ['https://cardgamesearcher.com/assets/img/cards/gcg/en/' + cardGameSearcherId + '.webp'];
  var officialUrls = /^EXB/i.test(id) || /^EXRP-/i.test(id) ? [] : [
    'https://www.gundam-gcg.com/en/images/cards/card/' + id + '.webp?260715=',
    'https://www.gundam-gcg.com/en/images/cards/card/' + id + '.webp?260715',
    'https://www.gundam-gcg.com/jp/images/cards/card/' + id + '.webp?260715=',
    'https://www.gundam-gcg.com/jp/images/cards/card/' + id + '.webp?260715'
  ];
  return [
    './gundam-images/' + id + '.webp',
  ].concat(cardListUrls, specialUrls, cardGameSearcherUrls, scrydexUrls, officialUrls);
}
var GUNDAM_SPECIAL_IMAGE_URLS = {
  'EXBP-018': [
    'https://www.gundam-gcg.com/gcg/bccard/jp/news/2026/02/03/0SvTY6C4SeNS5nws/%E3%82%B9%E3%83%A9%E3%82%A4%E3%83%891.webp'
  ]
};
var GUNDAM_CARDLIST_IMAGE_IDS = {
  'EXB-001':'616680',
  'EXR-001':'616679',
  'EXR-002':'684025',
  'EXR-004':'707586',
  'EXR-005':'707587',
  'EXR-006':'707588',
  'EXR-007':'707589',
  'EXR-008':'707590',
  'EXR-009':'707591',
  'EXR-010':'707585',
  'EXR-011':'707584',
  'EXRP-001':'634344',
  'EXRP-002':'641570',
  'EXRP-003':'653363',
  'EXRP-004':'680936',
  'EXRP-005':'680937',
  'EXRP-006':'680938',
  'EXRP-007':'680939',
  'EXRP-008':'680940',
  'EXRP-009':'680941',
  'EXRP-010':'680942',
  'EXRP-011':'680943',
  'EXRP-012':'680944',
  'EXRP-013':'680945',
  'EXRP-014':'681981',
  'EXBP-001':'634345',
  'EXBP-002':'641569',
  'EXBP-003':'646555',
  'EXBP-004':'641567',
  'EXBP-005':'641568',
  'EXBP-006':'653358',
  'EXBP-007':'653359',
  'EXBP-008':'653360',
  'EXBP-009':'653361',
  'EXBP-010':'653362',
  'EXBP-011':'661897',
  'EXBP-013':'684622',
  'EXBP-014':'684623',
  'EXBP-015':'684624',
  'EXBP-016':'684626',
  'EXBP-017':'684627',
  'EXBP-020':'691174',
  'EXBP-021':'691176',
  'EXBP-022':'691177',
  'EXBP-023':'691178',
  'EXBP-024':'691179',
  'EXBP-025':'708069',
  'EXBP-026':'708070',
  'EXBP-027':'708071'
};
function gundamStarterSupplement(id, number, setCode, setName, rarity, name, color, cost, level, ap, hp, zone, traits, link, text){
  var urls = officialGundamImageCandidates(id);
  if(id !== number) urls = urls.concat(officialGundamImageCandidates(number));
  return {
    id:id,
    number:number,
    game:'gundam',
    name:name,
    set_code:setCode,
    set_name:setName,
    rarity:rarity,
    type:'UNIT',
    color:color,
    cost:cost,
    level:level,
    ap:ap,
    hp:hp,
    zone:zone,
    traits:traits,
    link:link,
    text:text,
    image_url:urls[0],
    image_candidates:urls,
    price:null
  };
}
function gundamUtilitySupplement(id, setCode, setName, rarity, type, name, text){
  var urls = officialGundamImageCandidates(id);
  return {
    id:id,
    number:id,
    game:'gundam',
    name:name,
    set_code:setCode,
    set_name:setName,
    rarity:rarity,
    type:type,
    color:null,
    cost:null,
    level:null,
    ap:null,
    hp:null,
    zone:'-',
    traits:'',
    link:'-',
    text:text,
    image_url:urls[0],
    image_candidates:urls,
    price:null
  };
}
function applyStaticGundamSupplements(){
  var aileText = '<Blocker> (Rest this Unit to change the attack target to it.)\n【When Paired･Lv.4 or Higher Pilot】Choose 1 enemy Unit with 4 or less HP. Return it to its owner\'s hand.';
  var freedomText = 'While a friendly Base is in play, this Unit gets AP+2.\n【Attack】Choose 1 enemy Unit. Deal 2 damage to it.';
  var exResourceText = '(At the start of the game, the second-turn player places 1 active EX Resource into their resource area.)\n(Rest an EX Resource then exile it from the game when paying a cost.)';
  var exBaseText = "(At the start of the game, place 1 active EX Base as your shield area's base.)";
  var exResourcePromos = [
    ['EXRP-001', 'GAMA Expo 2025'],
    ['EXRP-002', 'Official Card Case Set 01'],
    ['EXRP-003', 'Bandai Card Games Fest 25-26'],
    ['EXRP-004', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-005', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-006', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-007', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-008', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-009', 'Premium Card Collection Gundam Assemble - PC01A'],
    ['EXRP-010', 'Premium Card Collection Gundam Assemble - PC02A'],
    ['EXRP-011', 'Premium Card Collection Gundam Assemble - PC02A'],
    ['EXRP-012', 'Premium Card Collection Gundam Assemble - PC02A'],
    ['EXRP-013', 'Premium Card Collection Gundam Assemble - PC02A'],
    ['EXRP-014', 'GAMA Expo 2026']
  ];
  var exBasePromos = [
    ['EXBP-001', 'Edition Beta Early Trial Event'],
    ['EXBP-002', 'Official Card Case Set 01'],
    ['EXBP-003', 'Gundam Base Pop-Up World Tour'],
    ['EXBP-004', 'First Combat'],
    ['EXBP-005', 'Bandai Card Games Fest 25-26'],
    ['EXBP-006', 'G Generation Eternal Collaboration Pack'],
    ['EXBP-007', 'G Generation Eternal Collaboration Pack'],
    ['EXBP-008', 'G Generation Eternal Collaboration Pack'],
    ['EXBP-009', 'G Generation Eternal Collaboration Pack'],
    ['EXBP-010', 'G Generation Eternal Collaboration Pack'],
    ['EXBP-011', 'Mobile Suit Gundam: Iron-Blooded Orphans'],
    ['EXBP-013', 'ST09 Release Event'],
    ['EXBP-014', 'ST09 Release Event'],
    ['EXBP-015', 'ST09 Release Event'],
    ['EXBP-016', 'ST09 Release Event'],
    ['EXBP-017', 'ST09 Release Event'],
    ['EXBP-018', 'The Sorcery of Nymph Circe Movie Release'],
    ['EXBP-019', 'Force Impulse Gundam'],
    ['EXBP-020', 'Starter Deck Battle Event'],
    ['EXBP-021', 'Starter Deck Battle Event'],
    ['EXBP-022', 'Starter Deck Battle Event'],
    ['EXBP-023', 'Starter Deck Battle Event'],
    ['EXBP-024', 'Starter Deck Battle Event'],
    ['EXBP-025', 'GD05 Freedom Ascension Deck Build Box'],
    ['EXBP-026', 'GD05 Freedom Ascension Deck Build Box'],
    ['EXBP-027', 'GD05 Freedom Ascension Deck Build Box']
  ];
  var supplements = [
    gundamStarterSupplement('ST04-001', 'ST04-001', 'ST04', 'SEED Strike', 'LR', 'Aile Strike Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Earth Alliance', '[Kira Yamato]', aileText),
    gundamStarterSupplement('ST04-001_p1', 'ST04-001', 'ST04', 'SEED Strike', 'LR +', 'Aile Strike Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Earth Alliance', '[Kira Yamato]', aileText),
    gundamStarterSupplement('ST04-001_p2', 'ST04-001', 'ST04', 'SEED Strike', 'LR +', 'Aile Strike Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Earth Alliance', '[Kira Yamato]', aileText),
    gundamStarterSupplement('ST04-001_p3', 'ST04-001', 'ST04', 'Limited BOX Ver. beta', 'LR +', 'Aile Strike Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Earth Alliance', '[Kira Yamato]', aileText),
    gundamStarterSupplement('ST04-001_p4', 'ST04-001', 'GD04', 'Phantom Aria', 'LR +', 'Aile Strike Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Earth Alliance', '[Kira Yamato]', aileText),
    gundamStarterSupplement('ST09-004', 'ST09-004', 'ST09', 'Destiny Ignition', 'LR', 'Freedom Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Triple Ship Alliance', '[Kira Yamato]', freedomText),
    gundamStarterSupplement('ST09-004_p1', 'ST09-004', 'ST09', 'Destiny Ignition', 'LR +', 'Freedom Gundam', 'White', 4, 5, 4, 4, 'Space Earth', 'Triple Ship Alliance', '[Kira Yamato]', freedomText),
    gundamUtilitySupplement('EXR-001', 'EXR', 'EX Resource Tokens', 'C', 'EX RESOURCE', 'EX Resource', exResourceText),
    gundamUtilitySupplement('EXR-002', 'EXR', 'EX Resource Tokens', 'C +', 'EX RESOURCE', 'EX Resource', exResourceText),
    gundamUtilitySupplement('EXR-003', 'EXR', 'EX Resource Tokens', 'C +', 'EX RESOURCE', 'EX Resource', exResourceText),
    gundamUtilitySupplement('EXB-001', 'EXB', 'EX Base Tokens', 'C', 'EX BASE', 'EX Base', exBaseText),
    gundamUtilitySupplement('EXB-002', 'EXB', 'EX Base Tokens', 'C', 'EX BASE', 'EX Base', exBaseText),
    gundamUtilitySupplement('EXB-003', 'EXB', 'EX Base Tokens', 'C', 'EX BASE', 'EX Base', exBaseText)
  ];
  exResourcePromos.forEach(function(promo){
    supplements.push(gundamUtilitySupplement(promo[0], 'EXRP', 'Promotional EX Resource Tokens', 'P', 'EX RESOURCE', 'EX Resource (' + promo[1] + ')', exResourceText));
  });
  exBasePromos.forEach(function(promo){
    supplements.push(gundamUtilitySupplement(promo[0], 'EXBP', 'Promotional EX Base Tokens', 'P', 'EX BASE', 'EX Base (' + promo[1] + ')', exBaseText));
  });
  mergeCards('gundam', supplements);
}

// ---------- App state ----------
var currentGame = 'gundam';
var currentTab = 'browse';
var filters = { search:'', set:'', color:'', type:'', rarity:'', sort:'set', nameMode:'contains' };
var deckSearchTerm = '';
var deckFilters = { set:'', color:'', type:'', rarity:'', sort:'set', nameMode:'contains' };
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
// Market price used for value totals: the user's own manual price for that
// exact printing takes precedence; otherwise fall back to the card's market
// price baked into the card database (TCGPlayer-sourced market data).
function effectivePrice(game, id, card){
  var e = state.collection[game] && state.collection[game][id];
  if(e && e.price != null) return e.price;
  return (card && card.price != null) ? card.price : null;
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
    : { id:id, name: name || 'New Deck', cards:{}, resources:{}, exResources:{}, exBases:{}, tokens:{}, allowExtraColors:false };
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
  if(game === 'gundam'){
    deck.resources = deck.resources || {};
    deck.exResources = deck.exResources || {};
    deck.exBases = deck.exBases || {};
    deck.allowExtraColors = !!deck.allowExtraColors;
  }
  deck.tokens = deck.tokens || {};
  return deck;
}
function bucketTotal(bucket){
  return Object.keys(bucket || {}).reduce(function(sum,k){ return sum + (bucket[k] || 0); }, 0);
}
function deckCardKey(card){ return card.id || card.number; }
function cardForDeckKey(idx, key){
  return idx.byId[key] || (idx.byNumber[key] || [])[0] || null;
}
function cardNumberForDeckKey(idx, key){
  var c = cardForDeckKey(idx, key);
  return (c && c.number) || key;
}
function deckMainQtyByNumber(deck, idx, number, exceptKey){
  return Object.keys(deck.cards || {}).reduce(function(sum, key){
    if(key === exceptKey) return sum;
    return cardNumberForDeckKey(idx, key) === number ? sum + (deck.cards[key] || 0) : sum;
  }, 0);
}
function deckMainQtyGroups(deck, idx){
  var groups = {};
  Object.keys(deck.cards || {}).forEach(function(key){
    var num = cardNumberForDeckKey(idx, key);
    groups[num] = (groups[num] || 0) + (deck.cards[key] || 0);
  });
  return groups;
}
function setLimitedBucketQty(deck, bucket, num, qty, limit){
  var cur = deck[bucket][num] || 0;
  var room = Math.max(0, limit - (bucketTotal(deck[bucket]) - cur));
  var next = Math.max(0, Math.min(qty, room));
  if(next === 0) delete deck[bucket][num]; else deck[bucket][num] = next;
  return next;
}
function changeDeckQty(game, deck, bucket, num, delta){
  var idx = getIndex(game);
  var cur = deck[bucket][num] || 0;
  var next = cur + delta;
  if(next < 0) next = 0;
  if(bucket === 'cards'){
    var cForLimit = cardForDeckKey(idx, num);
    var cardNumber = (cForLimit && cForLimit.number) || num;
    var roomMain = Math.max(0, 4 - deckMainQtyByNumber(deck, idx, cardNumber, num));
    if(next > roomMain) next = roomMain;
  }
  if(bucket === 'dons' && next > 10) next = 10;
  if(bucket === 'resources' && next > 10) next = 10;
  if((bucket === 'dons' || bucket === 'resources') && next > cur){
    var room = Math.max(0, 10 - (bucketTotal(deck[bucket]) - cur));
    next = cur + Math.min(next - cur, room);
  }
  if(next === 0) delete deck[bucket][num]; else deck[bucket][num] = next;
  saveState();
  if(next > cur){
    var c = bucket === 'cards' ? cardForDeckKey(idx, num) : (idx.byNumber[num]||[])[0];
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
    if(bucketTotal(deck.dons) >= 10){ toast('DON!! deck is full'); return; }
    deck.dons[card.number] = dcur + 1;
    toast('Added ' + card.name + ' to DON!! deck');
    cacheImage(card.image_url);
  } else if(game === 'gundam' && card.type === 'RESOURCE'){
    if(bucketTotal(deck.resources) >= 10){ toast('Resource deck is full'); return; }
    deck.resources[card.number] = (deck.resources[card.number]||0) + 1;
    toast('Added ' + card.name + ' to resource deck');
    cacheImage(card.image_url);
  } else if(game === 'gundam' && isExResourceCard(card)){
    deck.exResources[card.number] = (deck.exResources[card.number]||0) + 1;
    toast('Added ' + card.name + ' to EX resources');
    cacheImage(card.image_url);
  } else if(game === 'gundam' && isExBaseCard(card)){
    deck.exBases[card.number] = (deck.exBases[card.number]||0) + 1;
    toast('Added ' + card.name + ' to EX bases');
    cacheImage(card.image_url);
  } else if(isTokenCard(card)){
    deck.tokens[card.number] = (deck.tokens[card.number]||0) + 1;
    toast('Added ' + card.name + ' to tokens');
    cacheImage(card.image_url);
  } else {
    var key = deckCardKey(card);
    var cur = deck.cards[key] || 0;
    if(deckMainQtyByNumber(deck, getIndex(game), card.number) >= 4){ toast('Max 4 copies reached'); return; }
    deck.cards[key] = cur + 1;
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
    var dRoom = Math.max(0, 10 - (bucketTotal(deck.dons) - dcur));
    var dnext = Math.max(0, Math.min(10, dcur + (count > 0 ? Math.min(count, dRoom) : count)));
    if(dnext === 0) delete deck.dons[card.number]; else deck.dons[card.number] = dnext;
    changed = dnext - dcur;
  } else if(game === 'gundam' && card.type === 'RESOURCE'){
    var rcur = deck.resources[card.number] || 0;
    var rRoom = Math.max(0, 10 - (bucketTotal(deck.resources) - rcur));
    var rnext = Math.max(0, rcur + (count > 0 ? Math.min(count, rRoom) : count));
    deck.resources[card.number] = rnext;
    if(rnext === 0) delete deck.resources[card.number];
    changed = rnext - rcur;
  } else if(game === 'gundam' && isExResourceCard(card)){
    var ercur = deck.exResources[card.number] || 0;
    var ernext = Math.max(0, ercur + count);
    if(ernext === 0) delete deck.exResources[card.number]; else deck.exResources[card.number] = ernext;
    changed = ernext - ercur;
  } else if(game === 'gundam' && isExBaseCard(card)){
    var ebcur = deck.exBases[card.number] || 0;
    var ebnext = Math.max(0, ebcur + count);
    if(ebnext === 0) delete deck.exBases[card.number]; else deck.exBases[card.number] = ebnext;
    changed = ebnext - ebcur;
  } else if(isTokenCard(card)){
    var tcur = deck.tokens[card.number] || 0;
    var tnext = Math.max(0, tcur + count);
    if(tnext === 0) delete deck.tokens[card.number]; else deck.tokens[card.number] = tnext;
    changed = tnext - tcur;
  } else {
    var key = deckCardKey(card);
    var cur = deck.cards[key] || 0;
    var room = Math.max(0, 4 - deckMainQtyByNumber(deck, getIndex(game), card.number, key));
    var next = Math.max(0, Math.min(room, cur + count));
    if(next === 0) delete deck.cards[key]; else deck.cards[key] = next;
    changed = next - cur;
  }
  if(changed !== 0){
    if(changed > 0) cacheImage(card.image_url);
    saveState();
    toast((changed > 0 ? 'Added ' : 'Removed ') + Math.abs(changed) + 'x ' + card.name);
  } else if(count > 0) {
    toast(isOnePieceDonCard(card) ? 'DON!! deck is full' : (game === 'gundam' && card.type === 'RESOURCE') ? 'Resource deck is full' : 'Max 4 copies reached');
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
    var onePieceGroups = deckMainQtyGroups(deck, idx);
    var overCount = 0; Object.keys(onePieceGroups).forEach(function(k){ if(onePieceGroups[k]>4) overCount++; });
    if(overCount) errs.push(overCount + ' card(s) exceed the 4-copy limit');
    if(deck.leader){
      var leaderCard = (idx.byNumber[deck.leader]||[])[0];
      var leaderColors = ((leaderCard && leaderCard.color)||'').split(/[\s,\/]+/).filter(Boolean);
      var mismatched = 0;
      Object.keys(deck.cards).forEach(function(key){
        var cc = cardForDeckKey(idx, key);
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
    var gundamGroups = deckMainQtyGroups(deck, idx);
    var over2 = 0; Object.keys(gundamGroups).forEach(function(k){ if(gundamGroups[k]>4) over2++; });
    if(over2) errs.push(over2 + ' card(s) exceed the 4-copy limit');
    var colors = gundamDeckColors(deck, idx);
    if(colors.length > 2 && !deck.allowExtraColors) errs.push('Deck has ' + colors.length + ' colors (' + colors.join(', ') + '); Gundam decks are limited to 2 colors');
  }
  return errs;
}
function gundamDeckColors(deck, idx){
  var seen = {};
  Object.keys(deck.cards || {}).forEach(function(key){
    var c = cardForDeckKey(idx, key);
    cardColors(c).forEach(function(color){ seen[color] = true; });
  });
  return Object.keys(seen).sort();
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
function isExResourceCard(card){
  return !!(card && (card.type === 'EX RESOURCE' || /^EXR-/i.test(card.number || card.id || '')));
}
function isExBaseCard(card){
  return !!(card && (card.type === 'EX BASE' || /^EXB-/i.test(card.number || card.id || '')));
}
function isTokenCard(card){
  if(!card) return false;
  if(card.type === 'RESOURCE' || isOnePieceDonCard(card) || isExResourceCard(card) || isExBaseCard(card)) return false;
  var type = String(card.type || '');
  var num = String(card.number || card.id || '');
  return /TOKEN/i.test(type) || /^T-/i.test(num);
}
function quickStepsForCard(game, card){
  if(isOnePieceDonCard(card) || isTokenCard(card) || isExResourceCard(card) || isExBaseCard(card) || (game === 'gundam' && card.type === 'RESOURCE')){
    return [-1,-2,-3,-4,-10,1,2,3,4,10];
  }
  return [-1,-2,-3,-4,1,2,3,4];
}
function deckCardEntries(game, deck){
  var idx = getIndex(game);
  return Object.keys(deck.cards || {}).map(function(key){
    var card = cardForDeckKey(idx, key);
    return {
      key: key,
      num: cardNumberForDeckKey(idx, key),
      qty: deck.cards[key],
      card: card
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
// ---------- TCGPlayer "Buy" links ----------
var TCGPLAYER_PRODUCT_LINE = {
  onepiece: 'One Piece Card Game',
  gundam: 'Gundam Card Game'
};
function tcgplayerMassEntryUrl(game, items){
  var productLine = TCGPLAYER_PRODUCT_LINE[game] || '';
  var lines = items.map(function(it){
    var num = it.card.number || it.card.id || '';
    var setCode = it.card.set_code || '';
    return it.qty + ' ' + it.card.name + (setCode ? ' [' + setCode + ']' : '') + (num ? ' ' + num : '');
  });
  // TCGPlayer's Mass Entry page expects multiple items joined with a literal
  // "||" in the c= param - NOT a newline. Its own "Create a Shareable Link"
  // button confirms this (verified by generating one and inspecting the
  // resulting URL). A newline-joined c= silently fails to populate the items
  // box at all (no error shown), which is what caused "Buy all" to error out.
  return 'https://www.tcgplayer.com/massentry?c=' + encodeURIComponent(lines.join('||')) +
    '&productline=' + encodeURIComponent(productLine);
}
function tcgplayerProductSearchUrl(card){
  return tcgplayerMassEntryUrl(card.game, [{ card: card, qty: 1 }]);
}
function deckBuyItems(game, deck, idx){
  var items = {};
  function add(card, qty){
    if(!card || !qty || card.price == null) return;
    var key = card.number || card.id;
    if(!items[key]) items[key] = { card: card, qty: 0 };
    items[key].qty += qty;
  }
  if(game === 'onepiece' && deck.leader){
    add((idx.byNumber[deck.leader]||[])[0], 1);
  }
  deckCardEntries(game, deck).forEach(function(e){ add(e.card, e.qty); });
  if(game === 'onepiece'){
    Object.keys(deck.dons || {}).forEach(function(num){
      add((idx.byNumber[num]||[])[0], deck.dons[num]);
    });
  }
  if(game === 'gundam'){
    ['resources','exResources','exBases'].forEach(function(bucket){
      Object.keys(deck[bucket] || {}).forEach(function(num){
        add((idx.byNumber[num]||[])[0], deck[bucket][num]);
      });
    });
  }
  return Object.keys(items).map(function(k){ return items[k]; });
}

function renderDeckValueSummary(game, deck, idx){
  var container = document.getElementById('deck-value-summary');
  if(!container){
    container = document.createElement('div');
    container.id = 'deck-value-summary';
    container.className = 'collection-summary';
    var statsEl = document.getElementById('deck-stats');
    if(statsEl && statsEl.parentNode) statsEl.parentNode.insertBefore(container, statsEl);
  }
  var total = 0, unpriced = 0, count = 0;
  if(game === 'onepiece' && deck.leader){
    var lc = (idx.byNumber[deck.leader]||[])[0];
    if(lc){ count++; if(lc.price != null) total += lc.price; else unpriced++; }
  }
  var entries = deckCardEntries(game, deck);
  entries.forEach(function(e){
    count += e.qty;
    if(e.card && e.card.price != null) total += e.qty * e.card.price;
    else unpriced += e.qty;
  });
  if(game === 'onepiece'){
    Object.keys(deck.dons || {}).forEach(function(num){
      var qty = deck.dons[num];
      var dc = (idx.byNumber[num]||[])[0];
      count += qty;
      if(dc && dc.price != null) total += qty * dc.price;
      else unpriced += qty;
    });
  }
  if(game === 'gundam'){
    ['resources','exResources','exBases'].forEach(function(bucket){
      Object.keys(deck[bucket] || {}).forEach(function(num){
        var qty = deck[bucket][num];
        var bc = (idx.byNumber[num]||[])[0];
        count += qty;
        if(bc && bc.price != null) total += qty * bc.price;
        else unpriced += qty;
      });
    });
  }
  container.innerHTML =
    '<div class="summary-stat"><div class="val">$' + total.toFixed(2) + '</div><div class="lbl">Deck value' + (unpriced ? (' (' + unpriced + ' unpriced)') : '') + '</div></div>' +
    '<div class="summary-stat"><div class="val">' + count + '</div><div class="lbl">Priced cards counted</div></div>' +
    '<div class="summary-stat buy-all-stat"><button class="text-btn buy-all-btn" id="deck-buy-all-btn" type="button">Buy all on TCGPlayer</button></div>';
  var buyAllBtn = document.getElementById('deck-buy-all-btn');
  if(buyAllBtn){
    buyAllBtn.onclick = function(){
      var items = deckBuyItems(game, deck, idx);
      if(items.length === 0){ toast('No priced cards in this deck yet'); return; }
      window.open(tcgplayerMassEntryUrl(game, items), '_blank', 'noopener');
    };
  }
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
  Object.keys(deck.cards).sort().forEach(function(key){
    var c = cardForDeckKey(idx, key);
    lines.push(deck.cards[key] + 'x ' + key + (c ? ' ' + c.name + (c.rarity ? ' [' + c.rarity + ']' : '') : ''));
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
    lines.push('-- EX Resources --');
    Object.keys(deck.exResources || {}).sort().forEach(function(num){
      var c = (idx.byNumber[num]||[])[0];
      lines.push(deck.exResources[num] + 'x ' + num + (c ? ' ' + c.name : ''));
    });
    lines.push('-- EX Bases --');
    Object.keys(deck.exBases || {}).sort().forEach(function(num){
      var c = (idx.byNumber[num]||[])[0];
      lines.push(deck.exBases[num] + 'x ' + num + (c ? ' ' + c.name : ''));
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
    var m = line.match(/(\d+)\s*x?\s*([A-Za-z0-9\-_]+)/i);
    if(!m) return;
    var qty = parseInt(m[1],10);
    var rawKey = m[2];
    var num = rawKey.toUpperCase();
    var card = idx.byId[rawKey] || idx.byId[num] || (idx.byNumber[num]||[])[0];
    if(!card) return;
    if(game === 'onepiece' && card.type === 'Leader'){ deck.leader = num; }
    else if(game === 'onepiece' && isOnePieceDonCard(card)){ setLimitedBucketQty(deck, 'dons', card.number, qty, 10); }
    else if(game === 'gundam' && card.type === 'RESOURCE'){ setLimitedBucketQty(deck, 'resources', card.number, qty, 10); }
    else if(game === 'gundam' && isExResourceCard(card)){ deck.exResources[card.number] = qty; }
    else if(game === 'gundam' && isExBaseCard(card)){ deck.exBases[card.number] = qty; }
    else if(isTokenCard(card)){ deck.tokens[card.number] = qty; }
    else {
      var key = deckCardKey(card);
      var room = Math.max(0, 4 - deckMainQtyByNumber(deck, idx, card.number, key));
      deck.cards[key] = Math.min(qty, room);
      if(deck.cards[key] === 0) delete deck.cards[key];
    }
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
      Object.keys(deck.cards||{}).forEach(function(key){
        var c = cardForDeckKey(idx, key);
        if(c && c.image_url) urls[c.image_url] = true;
      });
      if(deck.resources){
        Object.keys(deck.resources).forEach(function(num){
          var c = (idx.byNumber[num]||[])[0];
          if(c && c.image_url) urls[c.image_url] = true;
        });
      }
      if(deck.exResources){
        Object.keys(deck.exResources).forEach(function(num){
          var c = (idx.byNumber[num]||[])[0];
          if(c && c.image_url) urls[c.image_url] = true;
        });
      }
      if(deck.exBases){
        Object.keys(deck.exBases).forEach(function(num){
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
// thousands of tiles, and firing an image request for every one of them
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
      setImageWithFallback(el, url.split('|'), name);
    });
  }, { rootMargin: '400px 0px', threshold: 0.01 });
  return _lazyObserver;
}
function imageUrlsForCard(cardOrUrl){
  if(!cardOrUrl) return [];
  if(typeof cardOrUrl === 'string') return [normalizeImageUrl(cardOrUrl)];
  var urls = [];
  if(cardOrUrl.image_url) urls.push(cardOrUrl.image_url);
  if(Array.isArray(cardOrUrl.image_candidates)) urls = urls.concat(cardOrUrl.image_candidates);
  if(cardOrUrl.game === 'gundam'){
    if(cardOrUrl.id) urls = urls.concat(officialGundamImageCandidates(cardOrUrl.id));
    if(cardOrUrl.number && cardOrUrl.number !== cardOrUrl.id) urls = urls.concat(officialGundamImageCandidates(cardOrUrl.number));
  }
  var seen = {};
  return urls.map(normalizeImageUrl).filter(function(u){
    if(!u || seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

// ---------- Google Drive appDataFolder sync ----------
var syncRuntime = { tokenClient:null, accessToken:null, fileId:null, busy:false, timer:null, status:'Google sync is not connected.' };
function googleSyncConfigured(){
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.indexOf('apps.googleusercontent.com') !== -1);
}
function maskClientId(id){
  id = String(id || '');
  if(!id) return '';
  if(id.length <= 16) return id.replace(/.(?=.{4})/g, '*');
  return id.slice(0, 8) + '********' + id.slice(-12);
}
function renderSyncStatus(){
  var status = document.getElementById('sync-status');
  var auto = document.getElementById('sync-auto');
  var clientInput = document.getElementById('sync-client-id');
  if(!status || !auto) return;
  auto.checked = !!(state.sync && state.sync.auto);
  if(clientInput && document.activeElement !== clientInput && !clientInput.value){
    clientInput.placeholder = GOOGLE_CLIENT_ID ? maskClientId(GOOGLE_CLIENT_ID) : 'Google OAuth Client ID';
  }
  if(!googleSyncConfigured()){
    status.textContent = 'Google sync is not configured yet. Paste your OAuth Web Client ID here and save it.';
    return;
  }
  status.textContent = syncRuntime.status || (syncRuntime.accessToken ? 'Google sync connected.' : 'Google sync is not connected.');
}
function setSyncStatus(msg){
  syncRuntime.status = msg;
  renderSyncStatus();
}
function getGoogleAccessToken(promptMode){
  return new Promise(function(resolve, reject){
    if(!googleSyncConfigured()){ reject(new Error('Google OAuth Client ID is not configured. Paste it into the sync panel and save it.')); return; }
    if(!window.google || !google.accounts || !google.accounts.oauth2){
      reject(new Error('Google sign-in library is still loading. Try again in a moment.'));
      return;
    }
    if(!syncRuntime.tokenClient){
      syncRuntime.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_DRIVE_SCOPE,
        callback: function(resp){
          if(resp && resp.access_token){
            syncRuntime.accessToken = resp.access_token;
            setSyncStatus('Google sync connected.');
            resolve(resp.access_token);
          } else {
            reject(new Error((resp && resp.error) || 'Google sign-in was cancelled.'));
          }
        }
      });
    } else {
      syncRuntime.tokenClient.callback = function(resp){
        if(resp && resp.access_token){
          syncRuntime.accessToken = resp.access_token;
          setSyncStatus('Google sync connected.');
          resolve(resp.access_token);
        } else {
          reject(new Error((resp && resp.error) || 'Google sign-in was cancelled.'));
        }
      };
    }
    syncRuntime.tokenClient.requestAccessToken({ prompt: promptMode || '' });
  });
}
function ensureGoogleAccess(){
  if(syncRuntime.accessToken) return Promise.resolve(syncRuntime.accessToken);
  return getGoogleAccessToken('consent');
}
function driveFetch(url, options){
  options = options || {};
  options.headers = options.headers || {};
  options.headers.Authorization = 'Bearer ' + syncRuntime.accessToken;
  return fetch(url, options).then(function(resp){
    if(resp.status === 401){
      syncRuntime.accessToken = null;
      throw new Error('Google session expired. Sign in again.');
    }
    if(!resp.ok){
      return resp.text().then(function(t){ throw new Error(t || ('Google Drive error ' + resp.status)); });
    }
    return resp;
  });
}
function findSyncFile(){
  var q = encodeURIComponent("name='" + SYNC_FILE_NAME.replace(/'/g, "\\'") + "' and trashed=false");
  return driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id,name,modifiedTime)').then(function(resp){
    return resp.json();
  }).then(function(data){
    var file = data.files && data.files[0];
    syncRuntime.fileId = file ? file.id : null;
    return file || null;
  });
}
function syncPayload(){
  return {
    app: 'tcg-vault',
    version: 1,
    savedAt: state.sync.updatedAt,
    state: state
  };
}
function createSyncFile(json){
  var boundary = 'tcgvault_' + Date.now();
  var body = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name:SYNC_FILE_NAME, parents:['appDataFolder'], mimeType:'application/json' }) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    json + '\r\n--' + boundary + '--';
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method:'POST',
    headers:{ 'Content-Type':'multipart/related; boundary=' + boundary },
    body:body
  }).then(function(resp){ return resp.json(); }).then(function(data){ syncRuntime.fileId = data.id; });
}
function updateSyncFile(json){
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(syncRuntime.fileId) + '?uploadType=media', {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:json
  });
}
function uploadLocalState(){
  if(syncRuntime.busy) return Promise.resolve();
  syncRuntime.busy = true;
  setSyncStatus('Uploading this device to Google Drive...');
  var json = JSON.stringify(syncPayload());
  return findSyncFile().then(function(file){
    return file ? updateSyncFile(json) : createSyncFile(json);
  }).then(function(){
    state.sync.lastSyncAt = new Date().toISOString();
    saveState({ skipUpdatedAt:true, skipSync:true });
    setSyncStatus('Uploaded to Google Drive.');
    toast('Uploaded sync backup');
  }).catch(function(err){
    setSyncStatus(err.message || 'Google sync upload failed.');
    toast('Google sync upload failed');
  }).then(function(){ syncRuntime.busy = false; });
}
function downloadRemotePayload(){
  return findSyncFile().then(function(file){
    if(!file) return null;
    return driveFetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media').then(function(resp){
      return resp.json();
    });
  });
}
function applyRemotePayload(payload){
  var next = payload && (payload.state || payload);
  if(!next || !next.collection || !next.decks) throw new Error('Google backup did not look like TCG Vault data.');
  state = normalizeLoadedState(next);
  state.sync.lastSyncAt = new Date().toISOString();
  saveState({ skipUpdatedAt:true, skipSync:true });
  renderFilterOptions();
  renderCurrentView();
}
function downloadRemoteState(){
  if(syncRuntime.busy) return Promise.resolve();
  syncRuntime.busy = true;
  setSyncStatus('Downloading backup from Google Drive...');
  return downloadRemotePayload().then(function(payload){
    if(!payload){ setSyncStatus('No Google Drive backup found.'); toast('No sync backup found'); return; }
    applyRemotePayload(payload);
    setSyncStatus('Downloaded backup from Google Drive.');
    toast('Downloaded sync backup');
  }).catch(function(err){
    setSyncStatus(err.message || 'Google sync download failed.');
    toast('Google sync download failed');
  }).then(function(){ syncRuntime.busy = false; });
}
function syncNow(){
  if(syncRuntime.busy) return Promise.resolve();
  syncRuntime.busy = true;
  setSyncStatus('Checking Google Drive backup...');
  return downloadRemotePayload().then(function(payload){
    if(!payload){
      syncRuntime.busy = false;
      return uploadLocalState();
    }
    var remoteTime = Date.parse(payload.savedAt || (payload.state && payload.state.sync && payload.state.sync.updatedAt) || 0) || 0;
    var localTime = Date.parse(state.sync.updatedAt || 0) || 0;
    syncRuntime.busy = false;
    if(remoteTime > localTime) return downloadRemoteState();
    if(localTime > remoteTime) return uploadLocalState();
    state.sync.lastSyncAt = new Date().toISOString();
    saveState({ skipUpdatedAt:true, skipSync:true });
    setSyncStatus('Already synced with Google Drive.');
    return null;
  }).catch(function(err){
    syncRuntime.busy = false;
    setSyncStatus(err.message || 'Google sync failed.');
    toast('Google sync failed');
  });
}
function scheduleAutoSync(){
  if(!state.sync || !state.sync.auto || !syncRuntime.accessToken) return;
  clearTimeout(syncRuntime.timer);
  syncRuntime.timer = setTimeout(function(){ syncNow(); }, 1800);
}
function setImageWithFallback(el, urls, name){
  var index = 0;
  function tryNext(){
    if(index >= urls.length) return;
    var img = new Image();
    img.alt = name || '';
    img.referrerPolicy = 'no-referrer';
    img.onload = function(){ el.innerHTML=''; el.appendChild(img); };
    img.onerror = function(){ index++; tryNext(); };
    img.src = urls[index];
  }
  tryNext();
}
function lazyLoadImage(el, cardOrUrl, name){
  var urls = imageUrlsForCard(cardOrUrl);
  if(urls.length === 0) return;
  var observer = getLazyObserver();
  if(!observer){
    // Fallback for browsers without IntersectionObserver: load immediately.
    setImageWithFallback(el, urls, name);
    return;
  }
  el.setAttribute('data-lazy-url', urls.join('|'));
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
  lazyLoadImage(div.querySelector('.thumb'), c, c.name);
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
          (c.price != null ? '<span class="tag">Market $' + c.price.toFixed(2) + '</span>' : '') +
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
      '<div><label class="small">&nbsp;</label><button class="text-btn buy-btn" id="buy-tcgplayer-btn">Buy on TCGPlayer</button></div>' +
    '</div>' +
    (variants.length ? (
      '<h3 class="section-label">Other printings (' + variants.length + ')</h3>' +
      '<div class="printing-list" id="printing-list"></div>'
    ) : '');
  lazyLoadImage(document.getElementById('modal-img'), c, c.name);
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
  document.getElementById('buy-tcgplayer-btn').onclick = function(){
    window.open(tcgplayerProductSearchUrl(c), '_blank', 'noopener');
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
      lazyLoadImage(row.querySelector('.p-thumb'), v, v.name);
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
  fillSelect('deck-filter-set', idx.sets.map(function(s){ return {value:s, label: s + (idx.setNames[s] ? ' - ' + idx.setNames[s] : '')}; }));
  fillSelect('deck-filter-color', idx.colors.map(function(c){ return {value:c, label:c}; }));
  fillSelect('deck-filter-type', idx.types.map(function(t){ return {value:t, label:t}; }));
  fillSelect('deck-filter-rarity', idx.rarities.map(function(r){ return {value:r, label:r}; }));
}
function matchesFilters(c){
  if(filters.set && c.set_code !== filters.set) return false;
  if(filters.color && (c.color||'').indexOf(filters.color) === -1) return false;
  if(filters.type && c.type !== filters.type) return false;
  if(filters.rarity && c.rarity !== filters.rarity) return false;
  if(filters.search){
    var s = searchText(filters.search).trim();
    if(filters.nameMode === 'exact'){
      if(searchText(c.name) !== s) return false;
    } else {
      var hay = searchText((c.name||'') + ' ' + (c.text||'') + ' ' + (c.number||''));
      if(hay.indexOf(s) === -1) return false;
    }
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
function matchesDeckFilters(c){
  if(deckFilters.set && c.set_code !== deckFilters.set) return false;
  if(deckFilters.color && (c.color||'').indexOf(deckFilters.color) === -1) return false;
  if(deckFilters.type && c.type !== deckFilters.type) return false;
  if(deckFilters.rarity && c.rarity !== deckFilters.rarity) return false;
  if(deckSearchTerm){
    var s = searchText(deckSearchTerm).trim();
    if(deckFilters.nameMode === 'exact'){
      if(searchText(c.name) !== s) return false;
    } else {
      var hay = searchText((c.name||'')+' '+(c.number||'')+' '+(c.text||''));
      if(hay.indexOf(s) === -1) return false;
    }
  }
  return true;
}
function sortDeckCards(list){
  var arr = list.slice();
  if(deckFilters.sort === 'name') arr.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  else if(deckFilters.sort === 'cost') arr.sort(function(a,b){ return numOrInf(a.cost) - numOrInf(b.cost); });
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
  filtered.forEach(function(c){ frag.appendChild(cardTile(c)); });
  grid.appendChild(frag);
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
  renderLegalityPanel(game, deck, errs, legEl, idx);
  renderDeckStats(game, deck);
  renderDeckValueSummary(game, deck, idx);

  var leaderSlot = document.getElementById('deck-leader-slot');
  var resourceSection = document.getElementById('deck-resource-section');
  var exResourceSection = document.getElementById('deck-ex-resource-section');
  var exBaseSection = document.getElementById('deck-ex-base-section');
  var donSection = document.getElementById('deck-don-section');
  if(game === 'onepiece'){
    leaderSlot.style.display = 'block';
    donSection.classList.remove('hidden');
    resourceSection.classList.add('hidden');
    exResourceSection.classList.add('hidden');
    exBaseSection.classList.add('hidden');
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
    exResourceSection.classList.remove('hidden');
    exBaseSection.classList.remove('hidden');
  }

  var listEl = document.getElementById('deck-list');
  var entries = deckCardEntries(game, deck);
  document.getElementById('deck-count').textContent = entries.reduce(function(a,e){ return a+e.qty; },0);
  listEl.innerHTML = '';
  if(entries.length === 0){
    listEl.innerHTML = '<div class="empty-state">No cards added yet.</div>';
  } else {
    entries.sort(function(a,b){ return a.num.localeCompare(b.num, undefined, {numeric:true}) || (a.key||'').localeCompare(b.key||'', undefined, {numeric:true}); });
    entries.forEach(function(e){
      var key = e.key, num = e.num, qty = e.qty;
      var c = e.card;
      var variants = c ? (idx.byNumber[c.number] || []) : [];
      var addPrintingControl = '';
      if(variants.length > 1){
        addPrintingControl = '<div class="deck-add-printing">' +
          '<select class="deck-add-printing-select" data-act="add-printing">' + variants.map(function(v){
            var vKey2 = deckCardKey(v);
            var label2 = (v.rarity || 'Printing') + ' - ' + (v.set_code || '') + (v.id !== v.number ? ' - ' + v.id : '');
            return '<option value="' + escapeAttr(vKey2) + '">' + escapeHtml(label2) + '</option>';
          }).join('') + '</select>' +
          '<button class="text-btn" data-act="add-printing-btn" type="button">+ copy as separate printing</button>' +
        '</div>';
      }
      var variantSelect = '';
      if(variants.length > 1){
        variantSelect = '<select class="deck-printing-select" data-act="printing">' + variants.map(function(v){
          var vKey = deckCardKey(v);
          var label = (v.rarity || 'Printing') + ' - ' + (v.set_code || '') + (v.id !== v.number ? ' - ' + v.id : '');
          var selected = vKey === key || (key === num && c && v.id === c.id);
          return '<option value="' + escapeAttr(vKey) + '"' + (selected ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
        }).join('') + '</select>';
      }
      var row = document.createElement('div');
      row.className = 'deck-row';
      row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div>' + variantSelect + addPrintingControl + '</div>' +
        '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button></div>';
      if(c && c.rarity) row.querySelector('.dsub').innerHTML = escapeHtml(num) + ' &middot; ' + escapeHtml(c.rarity);
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c, c.name);
      if(c) row.addEventListener('click', function(){ openCardModal(c); });
      var printingSelect = row.querySelector('[data-act="printing"]');
      if(printingSelect){
        printingSelect.onclick = function(e){ e.stopPropagation(); };
        printingSelect.onchange = function(e){
          e.stopPropagation();
          var newKey = e.target.value;
          if(newKey === key) return;
          deck.cards[newKey] = (deck.cards[newKey] || 0) + qty;
          delete deck.cards[key];
          var newCard = cardForDeckKey(idx, newKey);
          if(newCard) cacheImage(newCard.image_url);
          saveState();
          renderDeckView();
        };
      }
      var addPrintingBtn = row.querySelector('[data-act="add-printing-btn"]');
      if(addPrintingBtn){
        var addPrintingSelect = row.querySelector('[data-act="add-printing"]');
        if(addPrintingSelect) addPrintingSelect.onclick = function(e){ e.stopPropagation(); };
        addPrintingBtn.onclick = function(e){
          e.stopPropagation();
          var targetKey = addPrintingSelect ? addPrintingSelect.value : key;
          changeDeckQty(game, deck, 'cards', targetKey, 1);
          renderDeckView();
        };
      }
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'cards', key, -1); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'cards', key, 1); };
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
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c, c.name);
      if(c) row.addEventListener('click', function(){ openCardModal(c); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, -1); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, 1); };
      row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'resources', num, 10); };
      resList.appendChild(row);
    });
    renderDeckSpecialBucket(game, deck, idx, 'exResources', 'ex-resource-list', 'ex-resource-count', 'No EX resources added yet.');
    renderDeckSpecialBucket(game, deck, idx, 'exBases', 'ex-base-list', 'ex-base-count', 'No EX bases added yet.');
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
      if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c, c.name);
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
    if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c, c.name);
    if(c) row.addEventListener('click', function(){ openCardModal(c); });
    row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, -1); };
    row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, 1); };
    row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, 'tokens', num, 10); };
    tokenList.appendChild(row);
  });

  renderDeckAddGrid();
}
function renderDeckSpecialBucket(game, deck, idx, bucket, listId, countId, emptyText){
  var listEl = document.getElementById(listId);
  var entries = Object.keys(deck[bucket] || {}).map(function(k){ return [k, deck[bucket][k]]; });
  document.getElementById(countId).textContent = entries.reduce(function(a,e){ return a+e[1]; },0);
  listEl.innerHTML = '';
  if(entries.length === 0){
    listEl.innerHTML = '<div class="empty-state">' + escapeHtml(emptyText) + '</div>';
  }
  entries.sort(function(a,b){ return a[0].localeCompare(b[0], undefined, {numeric:true}); });
  entries.forEach(function(e){
    var num = e[0], qty = e[1];
    var c = (idx.byNumber[num]||[])[0];
    var row = document.createElement('div');
    row.className = 'deck-row';
    row.innerHTML = '<div class="deck-thumb"></div><div class="deck-card-meta"><div class="dname">' + escapeHtml(c?c.name:num) + '</div><div class="dsub">' + escapeHtml(num) + '</div></div>' +
      '<div class="stepper"><button data-act="minus">-</button><span>' + qty + '</span><button data-act="plus">+</button><button data-act="plus10">+10</button></div>';
    if(c) lazyLoadImage(row.querySelector('.deck-thumb'), c, c.name);
    if(c) row.addEventListener('click', function(){ openCardModal(c); });
    row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, bucket, num, -1); };
    row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, bucket, num, 1); };
    row.querySelector('[data-act="plus10"]').onclick = function(e){ e.stopPropagation(); changeDeckQty(game, deck, bucket, num, 10); };
    listEl.appendChild(row);
  });
}
function renderLegalityPanel(game, deck, errs, legEl, idx){
  var colors = game === 'gundam' ? gundamDeckColors(deck, idx) : [];
  var ignoredColorWarning = game === 'gundam' && deck.allowExtraColors && colors.length > 2;
  legEl.className = errs.length === 0 ? 'legality ok' : 'legality warn';
  var message = errs.length === 0 ? 'Deck is legal and ready to play.' : errs.join(' · ');
  if(ignoredColorWarning){
    message += ' Extra Gundam colors allowed for this deck (' + colors.join(', ') + ').';
  }
  legEl.innerHTML = '<span>' + escapeHtml(message) + '</span>';
  if(game === 'gundam'){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'text-btn legality-toggle';
    btn.textContent = deck.allowExtraColors ? 'Enforce 2-color rule' : 'Allow 3+ colors';
    btn.addEventListener('click', function(){
      deck.allowExtraColors = !deck.allowExtraColors;
      saveState();
      renderDeckView();
    });
    legEl.appendChild(btn);
  }
}
function renderDeckAddGrid(){
  var game = currentGame;
  var idx = getIndex(game);
  var deck = ensureActiveDeck(game);
  var grid = document.getElementById('deck-add-grid');
  var colorToggle = document.getElementById('deck-color-toggle');
  var list = idx.cards;
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
  list = sortDeckCards(list.filter(matchesDeckFilters));
  grid.innerHTML = '';
  var frag = document.createDocumentFragment();
  list.forEach(function(c){
    if(game === 'onepiece' && !deck.leader && c.type === 'Leader'){
      frag.appendChild(cardTile(c, function(card){
        addCardToDeck(game, card);
        renderDeckView();
      }));
    } else {
      frag.appendChild(deckAddTile(c, game));
    }
  });
  grid.appendChild(frag);
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
  var search = searchText(document.getElementById('collection-search').value || '');
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
      Object.keys(deck.cards).forEach(function(key){
        var num = cardNumberForDeckKey(idx, key);
        need[num] = (need[num]||0) + deck.cards[key];
      });
      if(game === 'gundam') Object.keys(deck.resources).forEach(function(n){ need[n] = (need[n]||0) + deck.resources[n]; });
      if(game === 'gundam' && deck.exResources) Object.keys(deck.exResources).forEach(function(n){ need[n] = (need[n]||0) + deck.exResources[n]; });
      if(game === 'gundam' && deck.exBases) Object.keys(deck.exBases).forEach(function(n){ need[n] = (need[n]||0) + deck.exBases[n]; });
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
    if(search) rows = rows.filter(function(r){ return searchText((r.card&&r.card.name)||'').indexOf(search) !== -1; });
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
      if(r.card) lazyLoadImage(row.querySelector('.cthumb'), r.card, r.card.name);
      if(r.card) row.addEventListener('click', function(){ openCardModal(r.card); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); adjustOwnedByNumber(game, r.num, -1); renderCollectionView(); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); adjustOwnedByNumber(game, r.num, 1); renderCollectionView(); };
      list.appendChild(row);
    });
  } else {
    // Trade binder: every distinct printing owned, shown separately (alt arts included).
    var binderRows = idx.cards.filter(function(c){ return collectionQty(game, c.id) > 0; });
    if(search) binderRows = binderRows.filter(function(c){ return searchText(c.name||'').indexOf(search) !== -1; });
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
        (function(){ var ep = effectivePrice(game, c.id, c); return '<div style="opacity:.7;font-size:12px">' + (ep != null ? ('$' + ep.toFixed(2) + ' ea &middot; $' + (ep*owned).toFixed(2) + ' total') : 'price N/A') + '</div>'; })() +
        '<div class="stepper"><button data-act="minus">-</button><span>' + owned + '</span><button data-act="plus">+</button></div>';
      lazyLoadImage(row.querySelector('.cthumb'), c, c.name);
      row.addEventListener('click', function(){ openCardModal(c); });
      row.querySelector('[data-act="minus"]').onclick = function(e){ e.stopPropagation(); setCollectionQty(game, c.id, collectionQty(game,c.id)-1); renderCollectionView(); };
      row.querySelector('[data-act="plus"]').onclick = function(e){ e.stopPropagation(); setCollectionQty(game, c.id, collectionQty(game,c.id)+1); renderCollectionView(); };
      list.appendChild(row);
    });
  }
  renderCacheStatus();
}
function renderCollectionSummary(game, idx){
  var totalOwned = 0, uniqueOwned = 0, totalValue = 0, unpriced = 0;
  idx.cards.forEach(function(c){
    var e = state.collection[game][c.id];
    if(e && e.qty){
      totalOwned += e.qty;
      uniqueOwned++;
      var ep = effectivePrice(game, c.id, c);
      if(ep != null) totalValue += e.qty * ep; else unpriced += e.qty;
    }
  });
  document.getElementById('collection-summary').innerHTML =
    '<div class="summary-stat"><div class="val">' + totalOwned + '</div><div class="lbl">Cards owned</div></div>' +
    '<div class="summary-stat"><div class="val">$' + totalValue.toFixed(2) + '</div><div class="lbl">Estimated value' + (unpriced ? (' (' + unpriced + ' unpriced)') : '') + '</div></div>' +
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
    filters = { search:'', set:'', color:'', type:'', rarity:'', sort:'set', nameMode:'contains' };
    deckFilters = { set:'', color:'', type:'', rarity:'', sort:'set', nameMode:'contains' };
    deckSearchTerm = '';
    document.getElementById('search-input').value = '';
    document.getElementById('deck-search').value = '';
    document.getElementById('filter-name-mode').value = 'contains';
    document.getElementById('deck-filter-name-mode').value = 'contains';
    document.getElementById('deck-filter-sort').value = 'set';
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
['filter-set','filter-color','filter-type','filter-rarity','filter-sort','filter-name-mode'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(e){
    var key = id === 'filter-name-mode' ? 'nameMode' : id.replace('filter-','');
    filters[key] = e.target.value;
    renderBrowse();
  });
});
document.getElementById('filter-toggle').addEventListener('click', function(){
  document.getElementById('filter-panel').classList.toggle('hidden');
});
document.getElementById('filter-clear').addEventListener('click', function(){
  var s = filters.search;
  var nameMode = filters.nameMode;
  filters = { search:s, set:'', color:'', type:'', rarity:'', sort:'set', nameMode:nameMode };
  ['filter-set','filter-color','filter-type','filter-rarity'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('filter-sort').value = 'set';
  document.getElementById('filter-name-mode').value = nameMode;
  renderBrowse();
});
document.getElementById('deck-search').addEventListener('input', function(e){
  deckSearchTerm = e.target.value;
  renderDeckAddGrid();
});
document.getElementById('deck-filter-toggle').addEventListener('click', function(){
  document.getElementById('deck-filter-panel').classList.toggle('hidden');
});
['deck-filter-set','deck-filter-color','deck-filter-type','deck-filter-rarity','deck-filter-sort','deck-filter-name-mode'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(e){
    var key = id === 'deck-filter-name-mode' ? 'nameMode' : id.replace('deck-filter-','');
    deckFilters[key] = e.target.value;
    renderDeckAddGrid();
  });
});
document.getElementById('deck-filter-clear').addEventListener('click', function(){
  var nameMode = deckFilters.nameMode;
  deckFilters = { set:'', color:'', type:'', rarity:'', sort:'set', nameMode:nameMode };
  ['deck-filter-set','deck-filter-color','deck-filter-type','deck-filter-rarity'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('deck-filter-sort').value = 'set';
  document.getElementById('deck-filter-name-mode').value = nameMode;
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
    : 'Clear all cards, resources, EX cards, and tokens from "' + deck.name + '"?';
  if(!confirm(msg)) return;
  deck.cards = {};
  if(game === 'onepiece') deck.dons = {};
  if(game === 'gundam'){
    deck.resources = {};
    deck.exResources = {};
    deck.exBases = {};
  }
  deck.tokens = {};
  saveState();
  renderDeckView();
});
document.getElementById('collection-search').addEventListener('input', renderCollectionView);
document.getElementById('collection-deck-filter').addEventListener('change', renderCollectionView);
document.getElementById('cache-all-btn').addEventListener('click', cacheAllRelevantImages);
document.getElementById('cache-clear-btn').addEventListener('click', clearImageCache);
document.getElementById('sync-signin').addEventListener('click', function(){
  getGoogleAccessToken('consent').then(function(){ return syncNow(); }).catch(function(err){
    setSyncStatus(err.message || 'Google sign-in failed.');
    toast('Google sign-in failed');
  });
});
document.getElementById('sync-save-client').addEventListener('click', function(){
  var input = document.getElementById('sync-client-id');
  var id = input ? input.value.trim() : '';
  if(!id || id.indexOf('apps.googleusercontent.com') === -1){
    setSyncStatus('That does not look like a Google OAuth Web Client ID.');
    toast('Check the client ID');
    return;
  }
  try { localStorage.setItem(GOOGLE_CLIENT_STORAGE_KEY, id); } catch(e){ /* ignore */ }
  GOOGLE_CLIENT_ID = id;
  syncRuntime.tokenClient = null;
  syncRuntime.accessToken = null;
  if(input){ input.value = ''; input.type = 'password'; input.placeholder = maskClientId(id); }
  var toggle = document.getElementById('sync-toggle-client');
  if(toggle) toggle.textContent = 'Show';
  setSyncStatus('Google OAuth Client ID saved on this device.');
  toast('Google sync ID saved');
});
document.getElementById('sync-toggle-client').addEventListener('click', function(){
  var input = document.getElementById('sync-client-id');
  var btn = document.getElementById('sync-toggle-client');
  if(!input) return;
  if(input.type === 'password'){
    input.type = 'text';
    if(!input.value) input.value = GOOGLE_CLIENT_ID || '';
    if(btn) btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    input.value = '';
    input.placeholder = GOOGLE_CLIENT_ID ? maskClientId(GOOGLE_CLIENT_ID) : 'Google OAuth Client ID';
    if(btn) btn.textContent = 'Show';
  }
});
document.getElementById('sync-clear-client').addEventListener('click', function(){
  if(!confirm('Clear the saved Google OAuth Client ID from this device?')) return;
  try { localStorage.removeItem(GOOGLE_CLIENT_STORAGE_KEY); } catch(e){ /* ignore */ }
  GOOGLE_CLIENT_ID = window.TCG_VAULT_GOOGLE_CLIENT_ID || '';
  syncRuntime.tokenClient = null;
  syncRuntime.accessToken = null;
  var input = document.getElementById('sync-client-id');
  if(input){ input.value = ''; input.type = 'password'; input.placeholder = GOOGLE_CLIENT_ID ? maskClientId(GOOGLE_CLIENT_ID) : 'Google OAuth Client ID'; }
  var toggle = document.getElementById('sync-toggle-client');
  if(toggle) toggle.textContent = 'Show';
  setSyncStatus(GOOGLE_CLIENT_ID ? 'Using the client ID from google-config.js.' : 'Google OAuth Client ID cleared from this device.');
  toast('Google sync ID cleared');
});
document.getElementById('sync-now').addEventListener('click', function(){
  ensureGoogleAccess().then(syncNow).catch(function(err){
    setSyncStatus(err.message || 'Google sync failed.');
    toast('Google sync failed');
  });
});
document.getElementById('sync-upload').addEventListener('click', function(){
  ensureGoogleAccess().then(uploadLocalState).catch(function(err){
    setSyncStatus(err.message || 'Google upload failed.');
    toast('Google upload failed');
  });
});
document.getElementById('sync-download').addEventListener('click', function(){
  if(!confirm('Replace this device with the Google Drive backup?')) return;
  ensureGoogleAccess().then(downloadRemoteState).catch(function(err){
    setSyncStatus(err.message || 'Google download failed.');
    toast('Google download failed');
  });
});
document.getElementById('sync-auto').addEventListener('change', function(e){
  state.sync.auto = e.target.checked;
  saveState({ skipUpdatedAt:true, skipSync:true });
  if(state.sync.auto){
    ensureGoogleAccess().then(syncNow).catch(function(err){
      setSyncStatus(err.message || 'Google auto-sync setup failed.');
      toast('Google auto-sync setup failed');
    });
  } else {
    clearTimeout(syncRuntime.timer);
    setSyncStatus(syncRuntime.accessToken ? 'Auto-sync is off. Google sync connected.' : 'Auto-sync is off.');
  }
});
document.getElementById('modal-overlay').addEventListener('click', function(e){
  if(e.target.id === 'modal-overlay') closeModal();
});

// ---------- Boot ----------
// Service worker auto-update: sw.js already calls skipWaiting()+clients.claim()
// on every install, so a new version takes control of open tabs as soon as it
// finishes installing - the browser just needs a reason to *check* for one.
// A normal reload triggers that check automatically, but a PWA opened from a
// phone's home screen is often just resumed from a frozen background state
// rather than freshly navigated, so it can go a long time without checking.
// We force a check whenever the app is foregrounded, and reload once a new
// worker actually takes over so the fresh app.js/styles.css get picked up
// without the user needing to manually clear site data.
function watchForServiceWorkerUpdates(reg){
  var reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(reloading) return;
    reloading = true;
    window.location.reload();
  });
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') reg.update().catch(function(){});
  });
  setInterval(function(){ reg.update().catch(function(){}); }, 60 * 60 * 1000);
}
function init(){
  applyStaticGundamSupplements();
  renderFilterOptions();
  renderCurrentView();
  renderSyncStatus();
  hydrateRemoteCards();
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
    navigator.serviceWorker.register('sw.js').then(watchForServiceWorkerUpdates).catch(function(){});
  }
}
init();

})();
