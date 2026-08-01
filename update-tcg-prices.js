// Pulls TCGPlayer market prices (via the free tcgcsv.com mirror, no API key
// required) for both One Piece Card Game (TCGPlayer categoryId 68) and
// Gundam Card Game (TCGPlayer categoryId 86), matches them against our own
// card files by printed card number, TCGPlayer set/group, and rarity (to
// disambiguate alt-art and reprint-across-sets printings), and writes the
// result back into the "price" field of onepiece_cards.js and gundam_cards.js.
//
// Before pricing runs, it also pulls the Gundam starter deck boxes (ST01-10)
// and the EX Resource / EX Base / Unit Token pools straight from gcgapi.com
// and folds in anything missing from gundam_cards.js. The live app fetches
// those same endpoints client-side on every page load, but only keeps the
// result in memory - so without this step, those cards (Close Combat and
// every other starter-deck card, the original EX Resources, every EX
// Resource promo) never actually exist in the file this script reads, and
// can never be priced or have their art mirrored no matter how good the
// matching logic is.
//
// Runs on GitHub Actions (see .github/workflows/update-tcg-prices.yml) on a
// daily schedule, so prices stay current without any manual work.
//
// Source: https://tcgcsv.com (community mirror of TCGplayer's own catalog +
// pricing API, updated daily, no auth required, no CORS support -
// intentionally meant for server-side use like this Action, not a browser).

const https = require('https');
const fs = require('fs');

const USER_AGENT = 'tcg-vault-price-sync/1.0 (github.com/SunkenRlyeh/tcg-vault)';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Normalizes rarity strings from two different vocabularies (our card data
// vs TCGPlayer's extendedData) so they can be compared loosely. Not exact -
// just enough to prefer the right variant when a number has more than one.
function normRarity(s) {
  if (!s) return '';
  s = String(s).toLowerCase().trim();
  const map = {
    l: 'leader', c: 'common', unc: 'uncommon', u: 'uncommon', r: 'rare',
    sr: 'super rare', sec: 'secret rare', p: 'promo', don: "don",
    lr: 'legend rare', ur: 'ultra rare',
  };
  return map[s] || s;
}

// Fetches every product + price for one TCGPlayer category and returns a
// map of cardNumber -> [{ productId, name, rarity, market, setCode }] (may
// have more than one entry per number when a card has alt-art / parallel
// printings, OR when the same card number gets reprinted as a promo in a
// later box - which TCGPlayer lists as separate products in separate groups).
// setCode is the TCGPlayer group's own abbreviation (e.g. "ST01", "GD05"),
// which lines up with our card data's set_code field and is what lets us
// tell those reprints-of-the-same-number apart.
async function buildCategoryPriceMap(categoryId, label) {
  const map = {};
  const groupsResp = await fetchJson('https://tcgcsv.com/tcgplayer/' + categoryId + '/groups');
  const groups = groupsResp.results || [];
  console.log(label + ': ' + groups.length + ' groups');
  for (const g of groups) {
    let products, prices;
    try {
      [products, prices] = await Promise.all([
        fetchJson('https://tcgcsv.com/tcgplayer/' + categoryId + '/' + g.groupId + '/products'),
        fetchJson('https://tcgcsv.com/tcgplayer/' + categoryId + '/' + g.groupId + '/prices'),
      ]);
    } catch (e) {
      console.log('  skip group ' + g.groupId + ' (' + g.name + '): ' + e.message);
      continue;
    }
    const priceByProduct = {};
    for (const p of (prices.results || [])) {
      (priceByProduct[p.productId] = priceByProduct[p.productId] || []).push(p);
    }
    for (const prod of (products.results || [])) {
      const ext = prod.extendedData || [];
      const numberField = ext.find((e) => e.name === 'Number');
      if (!numberField || !numberField.value) continue; // sealed product, not a card
      const rarityField = ext.find((e) => e.name === 'Rarity');
      const entries = priceByProduct[prod.productId] || [];
      const chosen = entries.find((p) => p.subTypeName === 'Normal' && p.marketPrice != null)
        || entries.find((p) => p.marketPrice != null);
      const number = numberField.value.trim();
      (map[number] = map[number] || []).push({
        productId: prod.productId,
        name: prod.name,
        rarity: rarityField ? rarityField.value : '',
        market: chosen ? chosen.marketPrice : null,
        setCode: g.abbreviation || '',
      });
    }
    await sleep(250); // be polite to tcgcsv.com per their usage guidelines
  }
  return map;
}

function normSet(s) { return String(s || '').trim().toLowerCase(); }

// --- Runtime-only Gundam card hydration -----------------------------------
//
// The live app (app.js, hydrateRemoteCards()) fetches a handful of Gundam
// card groups straight from gcgapi.com every time it loads - the ST01-ST10
// starter deck boxes, plus anything tagged EX RESOURCE / EX BASE / UNIT
// TOKEN - and merges them into window.GUNDAM_CARDS purely in memory. That
// merge is never written back to gundam_cards.js on disk, which means this
// script (and the image-mirroring workflow, which also only reads the file
// on disk) can never see those cards at all - not "can't price them right,"
// literally invisible. That's why starter-deck cards like Close Combat
// (ST03-013) and most EX Resources (the original EXR-001/002/003 plus every
// EXRP-* promo) never got a price no matter how the matching logic below was
// tuned.
//
// The fix: pull the exact same gcgapi.com endpoints here, normalize them the
// same way app.js does, and fold any card we don't already have into the
// array before pricing runs - so they become permanent, priceable,
// mirrorable entries instead of vanishing every time the tab closes.
const GCGAPI_BASE = 'https://api.gcgapi.com/v1';
const GUNDAM_STARTER_SETS = ['ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07', 'ST08', 'ST09', 'ST10'];
const GUNDAM_RUNTIME_TYPES = ['EX RESOURCE', 'EX BASE', 'UNIT TOKEN'];

function firstPresent(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

function normalizeGcgImageUrl(url) {
  if (!url) return url;
  if (url.indexOf('gundam-gcg.com/') !== -1) {
    return url.replace(/(\.webp\?\d+)$/, '$1=');
  }
  return url;
}

function parseEnvelope(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.results)) return payload.results;
  if (payload && Array.isArray(payload.cards)) return payload.cards;
  return [];
}

// Mirrors app.js's normalizeGundamCard field-for-field, so a card that gets
// persisted here looks identical to the one the client would otherwise have
// built in memory.
function normalizeGundamCard(raw) {
  const id = firstPresent(raw, ['product_id', 'id']);
  const num = firstPresent(raw, ['card_number', 'number']) || id;
  const traits = raw.traits || raw.trait || '';
  const links = raw.link_refs || raw.link || '';
  const image = normalizeGcgImageUrl(firstPresent(raw, ['image_url']));
  const imageCandidates = [image];
  if (id) {
    imageCandidates.push('https://www.gundam-gcg.com/en/images/cards/card/' + id + '.webp?260715=');
    imageCandidates.push('https://www.gundam-gcg.com/jp/images/cards/card/' + id + '.webp?260715=');
  }
  if (num && num !== id) {
    imageCandidates.push('https://www.gundam-gcg.com/en/images/cards/card/' + num + '.webp?260715=');
    imageCandidates.push('https://www.gundam-gcg.com/jp/images/cards/card/' + num + '.webp?260715=');
  }
  return {
    id: String(id || num),
    number: String(num || id),
    game: 'gundam',
    name: firstPresent(raw, ['name']) || '',
    set_code: firstPresent(raw, ['set_code']) || '',
    set_name: firstPresent(raw, ['set_name', 'where_to_get']) || '',
    rarity: firstPresent(raw, ['rarity']) || '',
    type: firstPresent(raw, ['card_type', 'type']) || '',
    color: firstPresent(raw, ['color']) || '',
    cost: firstPresent(raw, ['cost']),
    level: firstPresent(raw, ['level']),
    ap: firstPresent(raw, ['ap', 'ap_raw']),
    hp: firstPresent(raw, ['hp', 'hp_raw']),
    zone: firstPresent(raw, ['zone']) || '-',
    traits: Array.isArray(traits) ? traits.join(', ') : String(traits || ''),
    link: Array.isArray(links) ? links.join(', ') : String(links || '-'),
    text: firstPresent(raw, ['effect', 'text']) || '',
    image_url: image,
    image_candidates: imageCandidates.filter(Boolean),
    price: null,
  };
}

// Fetches every card the live app would otherwise only ever see at runtime:
// the 10 starter deck boxes plus the EX Resource / EX Base / Unit Token
// pools (which span sets and promos, not just one box). Each request is
// independent and best-effort - if gcgapi.com hiccups on one set or type we
// skip just that one rather than failing the whole run.
async function fetchRuntimeOnlyGundamCards() {
  const found = [];
  for (const setCode of GUNDAM_STARTER_SETS) {
    try {
      const payload = await fetchJson(GCGAPI_BASE + '/sets/' + setCode + '/cards');
      found.push(...parseEnvelope(payload).map(normalizeGundamCard));
    } catch (e) {
      console.log('  skip gcgapi set ' + setCode + ': ' + e.message);
    }
    await sleep(150);
  }
  for (const type of GUNDAM_RUNTIME_TYPES) {
    try {
      const payload = await fetchJson(GCGAPI_BASE + '/cards?card_type=' + encodeURIComponent(type) + '&limit=250');
      found.push(...parseEnvelope(payload).map(normalizeGundamCard));
    } catch (e) {
      console.log('  skip gcgapi type ' + type + ': ' + e.message);
    }
    await sleep(150);
  }
  return found;
}

// Folds newly-fetched cards into our on-disk array. Never overwrites a card
// we already have - this only ever fills gaps, so anything already
// committed (including any price already set on it) is left untouched.
function mergeRuntimeCards(cards, incoming) {
  const existing = {};
  cards.forEach((c) => { if (c && c.id) existing[c.id] = c; });
  let added = 0;
  incoming.forEach((c) => {
    if (!c || !c.id) return;
    if (existing[c.id]) return;
    cards.push(c);
    existing[c.id] = c;
    added++;
  });
  return added;
}

// Applies a TCGPlayer price map onto our own card array (mutates in place).
// Returns { matched, updated, cleared, total } counters for reporting.
//
// Card numbers alone aren't a safe key: the same printed number can show up
// as a full-price original AND as a promo reprint bundled into a totally
// different, later box (e.g. Amuro Ray ST01-010 also appears as a promo in
// the Freedom Ascension deck-build box, worth cents instead of hundreds of
// dollars). TCGPlayer lists those as separate products in separate groups.
// So a match is only ever made within the SAME set:
//   1. same card number + same set_code (TCGPlayer group abbreviation) +
//      same rarity - the exact match.
//   2. same number + same set_code, ignoring rarity - covers minor rarity
//      label mismatches between our data and TCGPlayer's.
// There is deliberately no cross-set fallback - guessing across sets is
// exactly what caused wildly wrong prices before. Some of our own printings
// also outnumber what TCGPlayer separately lists for a given set+number
// (our alt-art tracking is more granular than TCGPlayer's catalog in some
// spots) - those extra printings simply can't be confidently priced and are
// left/cleared to null rather than guessing, since a missing price is far
// less misleading than a wrong one.
function applyPrices(cards, priceMap) {
  const byNumber = {};
  for (const c of cards) (byNumber[c.number] = byNumber[c.number] || []).push(c);

  let matched = 0, updated = 0, cleared = 0;
  for (const number of Object.keys(byNumber)) {
    const ours = byNumber[number]; // our printings for this card number, in file order
    const theirs = (priceMap[number] || []).filter((e) => e.market != null);

    const claimed = new Set();
    for (const card of ours) {
      const cardSet = normSet(card.set_code);
      let pick = theirs.find((e, i) => !claimed.has(i) && normSet(e.setCode) === cardSet
        && normRarity(e.rarity) === normRarity(card.rarity));

      if (!pick) {
        pick = theirs.find((e, i) => !claimed.has(i) && normSet(e.setCode) === cardSet);
      }

      if (pick) {
        claimed.add(theirs.indexOf(pick));
        matched++;
        if (card.price !== pick.market) { card.price = pick.market; updated++; }
      } else if (card.price != null) {
        // No confident same-set match this run - clear out whatever price
        // was there before rather than let a possibly wrong value (e.g.
        // from an earlier, cross-set-guessing version of this script)
        // linger forever.
        card.price = null;
        cleared++;
      }
    }
  }
  return { matched, updated, cleared, total: cards.length };
}

function bumpCacheVersion() {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const m = sw.match(/const CACHE_NAME = 'tcg-vault-v(\d+)';/);
  if (!m) { console.log('Could not find CACHE_NAME in sw.js, skipping bump'); return; }
  const next = parseInt(m[1], 10) + 1;
  const newSw = sw.replace(/const CACHE_NAME = 'tcg-vault-v\d+';/, "const CACHE_NAME = 'tcg-vault-v" + next + "';");
  fs.writeFileSync('sw.js', newSw);
  console.log('Bumped sw.js cache version to v' + next);
}

async function main() {
  console.log('Fetching TCGPlayer price data via tcgcsv.com ...');
  const [opMap, gdMap] = await Promise.all([
    buildCategoryPriceMap(68, 'One Piece'),
    buildCategoryPriceMap(86, 'Gundam'),
  ]);

  let anyChanged = false;

  global.window = {};
  let src = fs.readFileSync('onepiece_cards.js', 'utf8');
  eval(src);
  let cards = global.window.ONEPIECE_CARDS;
  const opStats = applyPrices(cards, opMap);
  console.log('One Piece: matched ' + opStats.matched + '/' + opStats.total + ', changed ' + opStats.updated + ', cleared ' + opStats.cleared);
  if (opStats.updated > 0 || opStats.cleared > 0) {
    fs.writeFileSync('onepiece_cards.js', 'window.ONEPIECE_CARDS = ' + JSON.stringify(cards) + ';\n');
    anyChanged = true;
  }

  global.window = {};
  src = fs.readFileSync('gundam_cards.js', 'utf8');
  eval(src);
  cards = global.window.GUNDAM_CARDS;

  console.log('Fetching runtime-only Gundam cards (starter decks, EX resources/bases, tokens) from gcgapi.com ...');
  const runtimeCards = await fetchRuntimeOnlyGundamCards();
  const addedCount = mergeRuntimeCards(cards, runtimeCards);
  console.log('Gundam: merged ' + addedCount + ' previously runtime-only card(s) into the static file');

  const gdStats = applyPrices(cards, gdMap);
  console.log('Gundam: matched ' + gdStats.matched + '/' + gdStats.total + ', changed ' + gdStats.updated + ', cleared ' + gdStats.cleared);
  if (addedCount > 0 || gdStats.updated > 0 || gdStats.cleared > 0) {
    fs.writeFileSync('gundam_cards.js', 'window.GUNDAM_CARDS = ' + JSON.stringify(cards) + ';\n');
    anyChanged = true;
  }

  if (anyChanged) {
    bumpCacheVersion();
  } else {
    console.log('No price changes detected, leaving sw.js untouched');
  }

  // Always write a small status log, even on days with no price changes.
  // GitHub disables a *scheduled* workflow automatically after 60 days with
  // no commits to the repo (workflow runs alone don't count) - so without
  // this, a stretch of "nothing changed" days could silently let the daily
  // schedule go dormant. Writing this file guarantees there's always
  // something to commit, so the cron trigger never goes stale.
  const log = 'Last price sync: ' + new Date().toISOString() + '\n'
    + 'One Piece: matched ' + opStats.matched + '/' + opStats.total + ', changed ' + opStats.updated + ', cleared ' + opStats.cleared + '\n'
    + 'Gundam: merged ' + addedCount + ' runtime-only card(s), matched ' + gdStats.matched + '/' + gdStats.total + ', changed ' + gdStats.updated + ', cleared ' + gdStats.cleared + '\n';
  fs.writeFileSync('PRICE_SYNC_LOG.txt', log);
}

main().catch((e) => { console.error(e); process.exit(1); });
