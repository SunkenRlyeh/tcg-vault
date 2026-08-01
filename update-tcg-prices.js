// Pulls TCGPlayer market prices (via the free tcgcsv.com mirror, no API key
// required) for both One Piece Card Game (TCGPlayer categoryId 68) and
// Gundam Card Game (TCGPlayer categoryId 86), matches them against our own
// card files by printed card number (and rarity, to disambiguate alt-art
// printings), and writes the result back into the "price" field of
// onepiece_cards.js and gundam_cards.js.
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
// map of cardNumber -> [{ productId, name, rarity, market }] (may have more
// than one entry per number when a card has alt-art / parallel printings
// that TCGPlayer lists as separate products).
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
      });
    }
    await sleep(250); // be polite to tcgcsv.com per their usage guidelines
  }
  return map;
}

// Applies a TCGPlayer price map onto our own card array (mutates in place).
// Returns { matched, updated, total } counters for reporting.
function applyPrices(cards, priceMap) {
  const byNumber = {};
  for (const c of cards) (byNumber[c.number] = byNumber[c.number] || []).push(c);

  let matched = 0, updated = 0;
  for (const number of Object.keys(byNumber)) {
    const ours = byNumber[number]; // our printings for this card number, in file order
    const theirs = (priceMap[number] || []).filter((e) => e.market != null);
    if (theirs.length === 0) continue;

    const claimed = new Set();
    for (const card of ours) {
      // Prefer a rarity match; otherwise fall back to the first still-
      // unclaimed TCGPlayer entry (usually correct when there's only one
      // printing on TCGPlayer's side, or when order lines up).
      let pick = theirs.find((e, i) => !claimed.has(i) && normRarity(e.rarity) === normRarity(card.rarity));
      if (!pick) {
        const idx = theirs.findIndex((e, i) => !claimed.has(i));
        pick = idx !== -1 ? theirs[idx] : null;
      }
      if (pick) {
        claimed.add(theirs.indexOf(pick));
        matched++;
        if (card.price !== pick.market) { card.price = pick.market; updated++; }
      }
    }
  }
  return { matched, updated, total: cards.length };
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
  let stats = applyPrices(cards, opMap);
  console.log('One Piece: matched ' + stats.matched + '/' + stats.total + ', changed ' + stats.updated);
  if (stats.updated > 0) {
    fs.writeFileSync('onepiece_cards.js', 'window.ONEPIECE_CARDS = ' + JSON.stringify(cards) + ';\n');
    anyChanged = true;
  }

  global.window = {};
  src = fs.readFileSync('gundam_cards.js', 'utf8');
  eval(src);
  cards = global.window.GUNDAM_CARDS;
  stats = applyPrices(cards, gdMap);
  console.log('Gundam: matched ' + stats.matched + '/' + stats.total + ', changed ' + stats.updated);
  if (stats.updated > 0) {
    fs.writeFileSync('gundam_cards.js', 'window.GUNDAM_CARDS = ' + JSON.stringify(cards) + ';\n');
    anyChanged = true;
  }

  if (anyChanged) {
    bumpCacheVersion();
  } else {
    console.log('No price changes detected, leaving sw.js untouched');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
