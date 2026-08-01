TCG VAULT — Gundam Card Game & One Piece TCG database
========================================================

WHAT'S INSIDE
- Card browser with search + filters (set, color, type, rarity) for both games
- Deck builder with legality checks:
    One Piece: 1 Leader + 50-card deck, max 4 copies/card, leader color matching
    Gundam:    50-card main deck + 10-card resource deck, max 4 copies/card
- Trade binder / collection tracker that treats every alt-art printing as its
  own distinct entry (so a parallel, alternate art, or box topper is tracked
  separately from the regular version) — with its own quantity and price
- Selective offline card art: images are only cached for cards in your trade
  binder or in a saved deck, not the entire card library (see below)
- Deck export (.txt) / import (paste a list back in)
- Market price tracker: every card shows its market price (TCGPlayer-sourced
  data baked into the One Piece card database — a snapshot from when the data
  was compiled, not a live feed; see PRICE DATA note below). Deck view shows a
  total deck value plus a per-card price breakdown; Collection view shows
  total trade-binder value plus a per-card breakdown too. You can still
  override any individual printing's price by hand (e.g. what you actually
  paid) and that overrides the market price in all the totals.

CARD DATA INCLUDED
- One Piece TCG: the full run OP-01 through OP-16, plus Extra Boosters
  EB-01/02/03, Premium Boosters PRB-01/02, and all currently-available
  starter decks — ST-01 through ST-28, plus the ST-30 "Luffy & Ace" EX
  deck — 2,239 unique cards (3,079 total printings once every
  alt-art/parallel/box-topper variant is counted), sourced from the OPTCG
  API (optcgapi.com). Note: the OPTCG API exposes 29 starter decks (ST-01
  through ST-28, then ST-30 — ST-29 does not exist in this data source), not
  36; if a full 36-deck count is needed that would require a different data
  source.
- Gundam Card Game: booster sets GD01–GD05, the Eternal Nexus EX set, several
  starter decks, and promos — 826 unique cards (1,303 counting alt-art
  printings), sourced from the gcg-api project (gcgapi.com). The Gundam TCG
  currently has 10 starter decks total (ST01–ST10); this build has full data
  for the 5 main boosters and partial/starter coverage — ask if you want the
  rest of the starter decks pulled in too.
This is real, current card data, not placeholders.

PRICE DATA — WHAT'S ACTUALLY BEHIND IT
- One Piece: the market price shown per card comes from the OPTCG API, which
  itself aggregates TCGPlayer market pricing. It's a snapshot taken when this
  card database was compiled/updated, not a live price feed — TCGPlayer
  doesn't offer a no-signup public API, so pulling live prices on every card
  view isn't possible without you registering for TCGPlayer API partner
  access and providing a key. If you get one, ask and this can be wired up
  to refresh prices live instead of using the snapshot.
- Gundam: no price data yet. The Gundam card source (gcg-api / gcgapi.com)
  doesn't include pricing, so every Gundam card currently shows "price N/A"
  until a pricing source for Gundam singles is found and added.
- You can always override any specific printing's price by hand from the
  card's detail view — that entered value is used instead of the market
  price everywhere (deck value, collection value, etc.) for that printing.

OFFLINE CARD IMAGES — HOW IT WORKS
Per your request, card art is NOT bulk-downloaded for the whole library
(that would be a huge, mostly-wasted download). Instead:
  - Whenever you add a card to your trade binder (Collection tab) or to a
    deck, that specific printing's image is automatically saved for offline
    use — including alt arts, since each one is tracked separately.
  - The Collection tab has a small "offline images" panel showing how many
    images are cached, plus buttons to force-cache everything currently in
    your binder/decks, or clear the cache to reclaim space.
  - This only works once the app is loaded over HTTPS (see below) — the
    browser's Cache Storage API requires a secure origin. Opened as a plain
    local file, browsing/search/decks/collection still work fully offline,
    but the selective image caching feature needs HTTPS.

HOW TO USE IT — GITHUB PAGES (what you asked for)
GitHub Pages hosts this folder over HTTPS for free, which unlocks: installable
"Add to Home Screen" behavior, the service worker (offline app shell), and
the selective offline image caching described above.

This app is already deployed and live at:
  https://sunkenrlyeh.github.io/tcg-vault/
Source repo: https://github.com/SunkenRlyeh/tcg-vault

All files sit flat in the repo root (no data/ or icons/ subfolders) —
index.html, styles.css, app.js, onepiece_cards.js, gundam_cards.js,
manifest.json, sw.js, icon-192.png, icon-512.png — since GitHub's web
upload doesn't reliably preserve nested folders when dragging files in.
Open the live URL above on your phone. After the first load, "Add to Home
Screen" will be available, and everything you've cached will work offline.

To redeploy from scratch instead:
  1. Create a new GitHub repository (public repos get free Pages hosting).
  2. Upload every file in this folder as flat files (no subfolders) via
     "Add file" > "Upload files".
  3. Go to Settings > Pages, set Source to "Deploy from a branch", pick the
     branch (usually main) and root folder, then Save.
  4. GitHub gives you a URL like https://<username>.github.io/<repo>/.

If you'd rather test locally first: run `python3 -m http.server` from this
folder and open the printed address on your phone (same wifi network).

YOUR DATA
Your collection and decks are saved in the browser's local storage on
whichever device/browser you use the app in — they aren't synced between
devices or between opening the file locally vs. the hosted GitHub Pages
version (those count as different origins to the browser). Use "Export
list" in the deck builder to back up a deck as text.
