TCG VAULT
=========

A mobile-friendly card database and deck builder for the Gundam Card Game
and One Piece TCG. Live at:

    https://sunkenrlyeh.github.io/tcg-vault/

Works fully offline once loaded — install it to your phone's home screen
and it behaves like a native app.


FEATURES
--------

- Search and filter cards by set, color, type, and rarity, for both games
- Deck builder with real legality checks:
    One Piece — 1 leader, 50-card main deck, 10-card DON!! deck, token
    tracking, 4-copy max per card, leader color matching
    Gundam — 50-card main deck, 10-card resource deck, uncapped EX
    Resources/EX Bases, token tracking, 4-copy max per card
- Split alternate-art printings in the deck builder — e.g. 2 copies of a
  card in common printing and 2 more in a different printing, tracked and
  capped correctly as the same card
- Trade binder that treats every printing (parallel, alt art, box topper)
  as its own entry with its own quantity and price
- Live TCGPlayer market prices for both games, refreshed automatically
  every day — see PRICING below
- Offline card art for anything in your binder or decks, without caching
  the whole library (see OFFLINE IMAGES below)
- Deck export/import as plain text
- Quick deck controls: +/-1 through +/-4 on main-deck cards, +10 shortcuts
  for DON!!, resources, EX Resources, EX Bases, and tokens
- Optional Google Drive sync per user (see GOOGLE SYNC below)


CARD DATA
---------

One Piece TCG: OP-01 through OP-16, Extra Boosters EB-01/02/03, Premium
Boosters PRB-01/02, and every starter deck through ST-28 plus the ST-30
"Luffy & Ace" EX deck. 2,239 unique cards, 3,079 printings once alt arts
and parallels are counted. Base data from the OPTCG API (optcgapi.com);
DON!! cards are pulled in separately from OPTCG's DON!! endpoint.

Gundam Card Game: GD01–GD05, the Eternal Nexus EX set, starter decks
ST01–ST10, and promos. 826 unique cards, 1,303 printings counting alt
arts. Base data from the gcg-api project (gcgapi.com), with starter deck
cards filled in at runtime so repeated card numbers stay distinct.


PRICING
-------

Market prices come from TCGPlayer via tcgcsv.com, a free public mirror
of TCGPlayer's own catalog and pricing data (no signup or API key
needed). A GitHub Actions workflow (.github/workflows/update-tcg-prices.yml)
pulls fresh prices for both games every day at midnight UTC, matches them
against our card data by card number and rarity, and commits any changes
automatically. There's nothing to run by hand — it just stays current.

If you ever need to trigger a refresh manually: go to the Actions tab on
this repo, open "Update TCGPlayer market prices," and click "Run workflow."

update-tcg-prices.js is the script the workflow runs. It's plain Node.js
with no dependencies, so you can also run it locally with `node
update-tcg-prices.js` from the repo root if you want to test changes to
it before pushing.


OFFLINE IMAGES
--------------

Adding a card to your binder or a deck automatically caches that
printing's image for offline use, alt arts included. The Collection tab
has a small panel showing how many images are cached, with buttons to
cache everything in your binder/decks at once, or clear the cache.

This needs HTTPS to work, since the Cache Storage API requires a secure
origin — browsing, search, decks, and collection all work fine offline
even without it, just not the image caching.


RUNNING YOUR OWN COPY
----------------------

Everything sits as flat files in the repo root (no subfolders) because
GitHub's web upload doesn't reliably preserve folder structure when you
drag files in.

1. Create a new GitHub repo (public, so Pages hosting is free).
2. Upload every file here as flat files via "Add file" > "Upload files".
3. Go to Settings > Pages, set source to "Deploy from a branch," pick
   main and the root folder, save.
4. Your app will be live at https://<your-username>.github.io/<repo>/.

Open the live URL on your phone, then "Add to Home Screen" once it's
loaded. After that, anything you've cached works offline.


YOUR DATA
---------

Collections and decks are saved in your browser's local storage — per
device, per browser. Opening the file locally vs. the hosted GitHub
Pages version also counts as separate storage, since they're different
origins. Use "Export list" in the deck builder to back up a deck as
text, or set up Google sync below to carry data across devices.


GOOGLE SYNC (OPTIONAL)
----------------------

Lets a signed-in user store their collection/deck backup in their own
hidden Google Drive app-data folder. No server or database involved on
our end.

Setup:
1. In Google Cloud Console, create or pick a project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID, type "Web application."
5. Add https://sunkenrlyeh.github.io as an authorized JavaScript origin.
6. Paste the client ID into the (masked) Google OAuth Client ID field in
   the Collection tab's sync panel, then Save ID.

To set a default for everyone instead of per-browser, paste the same
client ID into google-config.js:

    window.TCG_VAULT_GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

Only the Drive app-data scope is requested
(https://www.googleapis.com/auth/drive.appdata), which stores a single
tcg-vault-sync.json file in each user's own hidden app-data folder. We
never see or host anyone's deck/collection data. The client ID itself is
public by design — Google OAuth client IDs aren't secrets — but it's
masked in the UI by default anyway.


LEGAL / COPYRIGHT
------------------

TCG Vault is an unofficial, non-commercial fan project. It is not
affiliated with, endorsed by, sponsored by, or approved by Bandai,
Bandai Namco, Bushiroad, or any other rights holder for the Gundam Card
Game or the One Piece Card Game.

"Gundam Card Game," "GUNDAM," "Mobile Suit Gundam," "One Piece Card
Game," and "ONE PIECE" are trademarks of their respective owners. All
card names, card text, artwork, images, and related game content shown
in this app are the property of their respective copyright and
trademark holders (including Bandai Namco Entertainment, Bandai
Namco Filmworks, Sunrise, Shueisha, Toei Animation, and Bushiroad, as
applicable) and are used here for identification and reference purposes
only, under fair use, in a non-commercial fan database and deck-building
tool.

Card data is sourced from third-party community APIs (gcg-api.com,
optcgapi.com) and market pricing from TCGPlayer via the tcgcsv.com
mirror, credited above. No ownership over any card content, artwork, or
game rules is claimed by this project or its author.

This app does not display ads, does not sell anything, and does not
charge for access. It's provided "as is," free of charge, for personal
collection tracking and deck building by fans of the games.

If you are a rights holder with a concern about content in this
project, please open an issue on the GitHub repository and it will be
addressed promptly.
