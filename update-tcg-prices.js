// Pulls TCGPlayer market prices (via the free tcgcsv.com mirror, no API key
// required) for both One Piece Card Game (TCGPlayer categoryId 68) and
// Gundam Card Game (TCGPlayer categoryId 86), matches them against our own
// card files by printed card number, TCGPlayer set/group, and rarity (to
// disambiguate alt-art and reprint-across-sets printings), and writes the
// result back into the "price" field of onepiece_cards.js and gundam_cards.js.
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

// Applies a TCGPlayer price map onto our own card array (mutates in place).
// Returns { matched, updated, total, fuzzy } counters for reporting.
//
// Card numbers alone aren't a safe key: the same printed number can show up
// as a full-price original AND as a promo reprint bundled into a totally
// different, later box (e.g. Amuro Ray ST01-010 also appears as a promo in
// the Freedom Ascension deck-build box). TCGPlayer lists those as separate
// products in separate groups, worth very different amounts. So we match in
// order of confidence:
//   1. same card number + same set_code (TCGPlayer group abbreviation) +
//      same rarity - the exact match.
//   2. same number + same set_code, ignoring rarity - covers minor rarity
//      label mismatches between our data and TCGPlayer's.
//   3. same number only, matched by rarity, across any set - last-resort
//      fallback for when our set_code doesn't correspond to a TCGPlayer
//      group abbreviation at all. Flagged as "fuzzy" since it's the one
//      case that can still cross sets and grab the wrong printing's price.
function applyPrices(cards, priceMap) {
  const byNumber = {};
  for (const c of cards) (byNumber[c.number] = byNumber[c.number] || []).push(c);

  let matched = 0, updated = 0, fuzzy = 0;
  for (const number of Object.keys(byNumber)) {
    const ours = byNumber[number]; // our printings for this card number, in file order
    const theirs = (priceMap[number] || []).filter((e) => e.market != null);
    if (theirs.length === 0) continue;

    const claimed = new Set();
    for (const card of ours) {
      const cardSet = normSet(card.set_code);
      let pick = null;
      let isFuzzy = false;

      pick = theirs.find((e, i) => !claimed.has(i) && normSet(e.setCode) === cardSet
        && normRarity(e.rarity) === normRarity(card.rarity));

      if (!pick) {
        pick = theirs.find((e, i) => !claimed.has(i) && normSet(e.setCode) === cardSet);
      }

      if (!pick) {
        pick = theirs.find((e, i) => !claimed.has(i) && normRarity(e.rarity) === normRarity(card.rarity));
        if (pick) isFuzzy = true;
      }

      if (pick) {
        claimed.add(theirs.indexOf(pick));
        matched++;
        if (isFuzzy) fuzzy++;
        if (card.price !== pick.market) { card.price = pick.market; updated++; }
      }
    }
  }
  return { matched, updated, total: cards.length, fuzzy };
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
  console.log('One Piece: matched ' + opStats.matched + '/' + opStats.total + ', changed ' + opStats.updated + ', fuzzy ' + opStats.fuzzy);
  if (opStats.updated > 0) {
    fs.writeFileSync('onepiece_cards.js', 'window.ONEPIECE_CARDS = ' + JSON.stringify(cards) + ';\n');
    anyChanged = true;
  }

  global.window = {};
  src = fs.readFileSync('gundam_cards.js', 'utf8');
  eval(src);
  cards = global.window.GUNDAM_CARDS;
  const gdStats = applyPrices(cards, gdMap);
  console.log('Gundam: matched ' + gdStats.matched + '/' + gdStats.total + ', changed ' + gdStats.updated + ', fuzzy ' + gdStats.fuzzy);
  if (gdStats.updated > 0) {
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
    + 'One Piece: matched ' + opStats.matched + '/' + opStats.total + ', changed ' + opStats.updated + ', fuzzy ' + opStats.fuzzy + '\n'
    + 'Gundam: matched ' + gdStats.matched + '/' + gdStats.total + ', changed ' + gdStats.updated + ', fuzzy ' + gdStats.fuzzy + '\n';
  fs.writeFileSync('PRICE_SYNC_LOG.txt', log);
}

main().catch((e) => { console.error(e); process.exit(1); });
