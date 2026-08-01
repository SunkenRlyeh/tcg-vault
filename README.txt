TCG VAULT — Gundam Card Game & One Piece TCG database
========================================================

WHAT'S INSIDE
- Card browser with search + filters (set, color, type, rarity) for both games
- Deck builder with legality checks:
    One Piece: 1 Leader + 50-card deck + 10-card DON!! deck + token tracking,
               max 4 main-deck copies/card, leader color matching
    Gundam:    50-card main deck + 10-card resource deck + token tracking,
               max 4 main-deck copies/card
- Trade binder / collection tracker that treats every alt-art printing as its
  own distinct entry (so a parallel, alternate art, or box topper is tracked
  separately from the regular version) — with its own quantity and price
- Selective offline card art: images are only cached for cards in your trade
  binder or in a saved deck, not the entire card library (see below)
- Deck export (.txt) / import (paste a list back in)
- Fast deck controls: main-deck cards support quick +/-1 through +/-4;
  DON!!, resources, and tokens also support +10 shortcuts. Tokens have no
  deck-limit check for now.

CARD DATA INCLUDED
- One Piece TCG: the full run OP-01 through OP-16, plus Extra Boosters
  EB-01/02/03, Premium Boosters PRB-01/02, and all currently-available
  starter decks — ST-01 through ST-28, plus the ST-30 "Luffy & Ace" EX
  deck — 2,239 unique cards (3,079 total printings once every
  alt-art/parallel/box-topper variant is counted), sourced from the OPTCG
  API (optcgapi.com), with DON!! cards supplemented at runtime from OPTCG's
  DON!! endpoint for collection and deck tracking.
- Gundam Card Game: booster sets GD01–GD05, the Eternal Nexus EX set, several
  starter decks, and promos — 826 unique cards (1,303 counting alt-art
  printings), sourced from the gcg-api project (gcgapi.com). Starter deck
  data ST01-ST10 is supplemented at runtime from GCGAPI so missing starter
  cards and repeated-name printings stay distinct by card number/printing ID.
This is real, current card data, not placeholders.

OFFLINE CARD IMAGES — HOW IT WORKS

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


YOUR DATA
Your collection and decks are saved in the browser's local storage on
whichever device/browser you use the app in — they aren't synced between
devices or between opening the file locally vs. the hosted GitHub Pages
version (those count as different origins to the browser). Use "Export
list" in the deck builder to back up a deck as text.
