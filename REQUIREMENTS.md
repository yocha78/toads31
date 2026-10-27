# Toads 31 — Requirements

Scoring web app for **Toad in the Hole**, the Sussex pub game, at `https://brightonpubguide.co.uk/toads31/`.

- **Owner:** Lionel Champalaune
- **Status:** Phase 1 (offline, single-device app) is built and live as `index.html` ("Version 22 Oct 2026 · Next to come"). Phase 2 (shared players, saved scores, live centralised tournaments on AWS) is specified below and not yet built.
- **Golden rule:** keep the existing interface and behaviour. Phase 2 adds to it; it does not redesign it.

---

## 1. Game rules the app must follow

### 1.1 Basics
- Players throw brass "toads" at a lead-topped table with a hole in the middle.
- **2 points** for a toad in the hole. **1 point** for a toad that stays on the table top. Nothing for misses or bounce-offs. The app does not enforce how points are judged; it just takes the turn's total.
- Each player (or team) starts on **31** and counts down. The winner is the first to reach **exactly 0**.
- **Bust:** if a turn scores more than the points left, the score does not change and play passes on.

### 1.2 Toads per turn
- The **1st turn of the game** throws **2 toads** (max 4 points).
- The **2nd turn of the game** throws **3 toads** (max 6 points).
- **Every later turn** throws **4 toads** (max 8 points). In a game of 3 or more, the third player's first turn is already 4 toads.
- **Near the end:** a player never throws more toads than the points they have left. Needing 3 means throwing 3 toads; needing 1 means 1 toad.
- Toads for a turn = `min(base, points left)`, where base is 2 / 3 / 4 by the game's turn index (0 / 1 / 2+).

### 1.3 Score entry
- The keypad shows only scores the toads can make: `0 … 2 × toads`. For example, 2 toads shows 0–4.
- Scores above the points left still appear, styled dashed. Tapping one records a bust.

### 1.4 Ambiguous finish
- When a winning score could have been made with fewer toads than the player had, ask: *"<name> finishes on <n>! How many toads did they throw?"*
  - Options run from `ceil(n / 2)` up to the toads available. Example: needing 5 with 4 toads asks "3 toads" or "4 toads".
  - Ask only when it is ambiguous, i.e. `ceil(n/2) < toads`. Needing 1 with 1 toad finishes straight away.
  - "Wrong score, go back" returns to the keypad without recording anything.

### 1.5 Throwing order
- Before **every** game, each player (or one player per team) throws one toad. The scorer taps them from closest to the hole to furthest; closest throws first.
- **Exception, tournament matches (24 Oct 2026):** game 2 of a match skips this step and swaps game 1's order (whoever threw first in game 1 throws second). A game 3 asks again.
- When one is left, it is placed last automatically.
- "Start over" and "Back" are available.
- A solo game skips this step.

---

## 2. Statistics

### 2.1 Average per toad (end of game)
- **Average per toad = points thrown ÷ toads thrown.** It ranges from 0 to 2 and is shown with 2 decimals.
- **Busts count the points actually thrown.** They don't change the score, but they count towards the average.
- On an ambiguous finish, use the number of toads the player says they threw.

### 2.2 Duo statistics
- A team average (whole team) plus each partner's own average, points and toads thrown.

### 2.3 Win tally
- Chalk tally bars next to each name: one bar per win, and every 5th bar strikes through the previous four.
- **Single:** wins per player across games.
- **Duo:** wins per team, kept separate from player wins.
- **Tournament:** games won in the current match.

---

## 3. Phase 1 — current app (built)

A static app in `app/` with no back end: `index.html`, `css/app.css`, `js/rules.js` (the game rules, pure functions with automated tests in `tests/`) and `js/app.js` (screens and buttons). State is kept in the browser's `localStorage` under the key `toads31`, and survives reloads.

### 3.1 Modes (switch on the start screen)

#### Single game
- One or more players, all in one game, in the order chosen on the throwing-order screen.
- Player names must be unique.

#### Duo
- Teams of two share one score from 31.
- **Team setup:**
  - Each team has an editable name (default "Team 1", "Team 2"…).
  - Each team has a "Throws 1st" and a "Throws 2nd" player, picked from the player list, with a Swap button.
  - A player can only be in one team.
  - "Add a team" auto-fills with the next two free players. Switching to Duo with 2+ players creates the first team automatically.
  - Start is disabled until every team has two different players and a unique, non-empty name. A hint explains what is missing.
- **Order:** the throwing-order screen orders the **teams**. Its wording reads "One player from each team throws a toad…".
- **Alternation:** each time it is a team's turn, the partners alternate. The 1st player throws on the team's 1st turn, the 2nd player on its 2nd turn, and so on.
- **Game screen:** shows the thrower's name, with "Team · Needs n · …" below.
- **Chalkboard:** each team column shows the team name, with both partners underneath. The next thrower is underlined in yellow.
- **Winner screen:**
  - "Winning team", followed by "A & B hit exactly 31 in round n."
  - An extra "Each player" row shows each partner's average, points and toads.
  - Buttons: "Play again" (same teams) and "Change teams".

#### Tournament
- **Format:** knockout, one against one. Each match is **first to 2 games** (best of 3). Minimum 2 players.
- **Draw:**
  - Pairs follow the player list: 1 v 2, 3 v 4…
  - "Shuffle the draw" is offered when there are 3+ players.
  - An odd player out gets a **bye**. It always goes to the last entry, so the same player can get repeated byes.
- **Qualifying round** (when the number of players is not 2, 4, 8, 16, 32…):
  - **Opponents:** players sit in a circle in draw order, and each plays the nearest players either side. Everyone plays the same number of matches, each first to 2 games: **2 by default** (the two either side; with 3 players that is everyone against everyone). The organiser can pick 1 to 6 at setup (see §4.5); an odd number adds the player straight across the circle, so it needs an even number of players.
  - **Parallel tables:** qualifying matches run on the tables like any other match. A player is never put on two tables at once.
  - **Ranking:** matches won, then games won minus lost, then average per toad (from the player's qualifying games), then head-to-head (if they played each other), then draw order.
  - **Who goes through:** the top K enter the knockout, where K is the largest of 2, 4, 8, 16, 32… that fits (e.g. 5–7 players → 4, 9–15 → 8, 17–31 → 16).
  - **Seeding:** standard knockout seeding (1 v K, 2 v K−1…), placed so seeds 1 and 2 can only meet in the final.
  - **Standings:** a chalkboard "Qualifying" table on the Tables screen shows rank, played, won, games +/− and average per toad. Qualifiers are in yellow, above a dashed cut line. The section is **collapsible**: tapping its header folds it to one line (e.g. "3 of 5 matches played · top 4 go through"), and the state is remembered.
  - **Setup hint:** the start screen explains which format the current number of players gives.
- **Format choice** (only shown when the number of players is not 2, 4, 8, 16, 32…): **Qualifying round** (default, above) or **Byes**.
- **Byes format:**
  - **Bracket size:** rounded up to the next 2/4/8/16/32…, and the spare places are round-1 byes, e.g. 6 players → 8-player bracket with 2 byes.
  - **Who gets them:** players picked **at random**.
  - **Round 1 only:** byes only happen in round 1, so nobody gets a second free pass and every bye player still has to win at least one match before the final. The one unavoidable exception is 3 players, where the bye goes straight to the final.
  - **Placement:** bye places are spread through the bracket (standard seed positions), so a bye player usually meets a round-1 winner next. The remaining players are paired in list order.
  - **Note:** with player counts just above a power of two (e.g. 9 or 17), most players get a bye, so the Qualifying round is usually the better choice there.
- **Whole bracket built upfront:** each later match takes the winners of two matches above it. As soon as both feeder matches finish, the next match becomes ready, without waiting for the whole round.
- **Round names:** Final, Semi-finals, Quarter-finals, otherwise "Round n".
- **Tables:**
  - "Tables available" stepper, 1–8. It is capped at the number of real first-round matches.
  - Matches run in parallel, one per table. Ready matches are assigned to free tables, earliest round first. A match keeps its table for all its games.
  - **Next to come:** below the table cards, a section listing matches whose players are known but have no table yet. It is **collapsed by default** and shows only a one-line summary, e.g. "3 matches · table pending". Opened, each match shows its round and a status: "Table pending", or "Waiting for <player>" while that player is still playing elsewhere. The open/closed state is remembered.
- **Tables screen (hub):**
  - One card per table, **one card per row**, kept compact: the "Start game n" / "Continue" button sits on the right, beside the players' names, not below them.
  - Each card shows: table number, status pill (Ready / Playing / Free), the match "A v B", the round, game number and match score. While a game is in progress it also shows each player's points left.
  - The button on each card is "Start game n" or "Continue game".
  - The Tables section is **collapsible**. When collapsed, it shows a summary such as "1 playing · 1 ready · 1 free". The collapsed state is remembered.
  - "End tournament" (with confirmation; all results are lost) sits inside the Tables section.
- **Moving between tables:** "Back to tables" leaves a game exactly as it is, so the scorer can switch between tables freely.
- **Chalkboard bracket:**
  - Columns per round, with "?" for unknown players and "bye" entries.
  - Live matches are outlined in yellow with a "Table n" badge.
  - Winners are shown in yellow, losers struck through. A champion column is added at the end.
- **After each game:**
  - "Game n won", with buttons "Start game n+1" and "Back to tables".
  - "Match won … Table n is free", with "Back to tables".
  - "Tournament champion", with "See the bracket" and "New tournament".
- **Wins:** tournament games do not count towards the single-game win tally.

### 3.2 Game screen
- **Panel:** "Throwing now", the thrower's name, and a line such as "Needs 27 · 4 toads (max 8) · Round 2". In a tournament, a line above reads "Table n · Round name · Game n · A x–y B".
- **Keypad:** compact, 5 columns. Each score is a plain toad shape (the scoreboard's toad icon, in its chalk yellow) with the number on its body; bust scores are greyed out (25 Oct 2026).
- **Messages:** after each turn, e.g. "Al scores 4." (in wood brown, like the scoreboard frame) or "Bust! Al stays on 5." In Duo: "Di scores 4 for Hole Lotta."
- **Buttons:**
  - "Undo last turn".
  - "End game" (Single/Duo, with confirmation) or "Back to tables" (Tournament).
- **On the winner screen:** "Undo winning throw" reverses the win, including tallies and match scores.

### 3.3 Chalkboard scoresheet
- A slate board in a wooden frame, with hand-drawn chalk fonts. It looks the same in light and dark mode.
- **One column per player or team:** name with tally, big "points left" number, "left" label and a progress bar.
- **Round numbers appear once, down the left** (R1, R2…). Each cell shows the turn's score (normal weight) with a small brass toad icon, then the points left (bold).
- Busts are struck through in red chalk.
- The player throwing now is highlighted in yellow, with a wavy underline.
- **Circled scores:** points left of **8 or less** (and above 0) get a hand-drawn chalk circle, on the main number and on the round list, to show the player can win on the next turn.
- **End-of-game rows:**
  - "Avg /toad" row.
  - In Duo, an "Each player" row.
  - The note below explains the average and the bust rule.
- The board scrolls sideways inside its frame when there are many columns. The page itself never scrolls sideways.

### 3.4 Winner screen
- A heading (Winner / Winning team / Game n won / Match won / Tournament champion), then a **small toad icon next to the winner's name** on one line, then a one-line summary and the buttons.
- Below that: the full chalkboard results.

### 3.5 Visual design
- **Header:** logo of a toad table, drawn from a real pub table. It shows a rounded wooden backboard, a grey lead top in perspective with a central hole, a brass toad on the lead, a drawer with a brass cup handle and barley-twist legs. Beside it: "Toads **31**" and the line "Count down from 31. 2 in the hole, 1 on the table. Finish exactly."
- **Toad icon:** a simple brass frog silhouette. It is used next to scores, on the winner screen and on the champion entry.
- **Browser tab and home-screen icon (27 Oct 2026):** the same toad in chalk yellow on the slate chalkboard colour, in `app/img/` (SVG, a 32 px PNG and a 180 px Apple touch icon).
- **Fonts (Google Fonts):**
  - Alfa Slab One (display).
  - Atkinson Hyperlegible (body).
  - Cabin Sketch and Patrick Hand (chalk).
- **Colours:**
  - Brass: `#b8862b` (light) / `#d9a845` (dark).
  - Wood: `#7a4a24` / `#4a2c16`.
  - Lead: `#a9afb4` / `#6f767b`.
  - Slate: `#1f2a26`.
  - Chalk: `#ecece4`.
  - Chalk yellow: `#f2d36b`.
  - Chalk red: `#f08a7e`.
- **Themes:** the app follows the phone's light/dark setting.
- **Layout:** mobile-first, works at 400px wide, with 16px side margins.
- **Wording:** plurals must be correct ("1 toad", "2 toads"). The language is British English.
- **Version label:** a small label at the bottom, e.g. "Version 22 Oct 2026 · Next to come". Update it on every release so the live version can be checked at a glance.

### 3.6 Hosting today
- The contents of `app/` (`index.html` plus the `css/` and `js/` folders) are uploaded by hand into `public_html/toads31/` on GoDaddy, until the Phase 2 deploy workflow takes over (see section 5.3). It sits next to WordPress; real folders bypass WordPress routing.
- **Known pitfalls:**
  - Downloaded copies get renamed (e.g. `index (3).html`).
  - Server or browser caching.
  - Use `?v=n` to force a fresh load, and check the version label.

---

## 4. Phase 2 — shared, centralised app (to build)

### 4.1 Goals
1. **Stay a web app.** No native app and no App Store. Same interface, served from `/toads31` on GoDaddy.
2. **Be independent of WordPress.** WordPress only happens to share the website; no plugin, and no use of its database or users.
3. **Players section:** register players once, then pick them from a list when setting up any game.
4. **Scores saved per player:** every finished Single, Duo and Tournament game is stored turn by turn. Each player has a stats page.
5. **Centralised tournaments:** the organiser creates a tournament, and anyone with the link can follow the tables and bracket live. People at each table enter their own scores from their own phones.

### 4.2 Architecture

| Part | Where | What |
|---|---|---|
| App (front end) | GoDaddy `/toads31` | Static HTML/CSS/JS, the current app extended. API address set in a small `config.js`. |
| API | AWS API Gateway (HTTP API) + Lambda (Node.js) | Small functions: players, games, turns, tournaments, table claiming. Validates PINs and organiser token, then reads and writes the database. |
| Database | AWS DynamoDB, on-demand | Players, games, turns, tournaments, matches, tables. |
| Region | `eu-west-2` (London) | |
| Infrastructure as code | AWS SAM template | Creates the table, functions and API together. Separate stacks for test and live. |
| Organiser login | Organiser password stored in AWS (SSM Parameter Store or Secrets Manager); the API returns a short-lived token | Upgrade to Amazon Cognito later if several organisers need accounts. |
| Live updates | Polling every 3–5 s while the page is visible | WebSockets are optional later. |

The browser must **never** hold AWS credentials or talk to DynamoDB directly.

### 4.3 Players
- **Anyone can add players.** No login is needed to register a player.
- Fields: display name (unique, case-insensitive), created date. No email or other personal data unless decided later.
- **Housekeeping (organiser only):** rename, merge duplicates (e.g. "Dave" and "Dave B") and delete. API throttling limits spam.
- **Players section:**
  - List, add and rename players.
  - Delete a player, which also deletes their data (privacy).
- Setup screens (Single, Duo, Tournament) pick players from this shared list instead of typing names.
- **Built so far (step 4, Oct 2026):** `GET/POST /players` and `/venues`. On the setup screen, registered players appear as buttons to tap (filtered by what is typed), a typed name that matches a registered player takes its spelling, and any other name is a guest with a **Register** button. The venue field offers known venues and remembers the last one; a new venue is added to the shared list when it is entered. Both lists are kept on the phone, so setup still works with no signal. Rename, merge and delete wait for the organiser login (step 6). With no API configured, the setup screen is exactly as in Phase 1.
- **Built in step 6 (Oct 2026):** a **Players & stats** button on the setup screen opens the list of registered players. Tapping one shows their stats: games played and won, win rate, average per toad, by month, best game (highest points per toad, at least 4 toads), head-to-head against each opponent (guests included) and the latest 10 games, all filterable by pub. The organiser logs in on the Players screen with the password from AWS Parameter Store (`/toads31/<stage>/organiser-password`, see docs/aws-setup.md) and gets a 12-hour token; they can then rename, merge or delete a player (merge moves the duplicate's games across) and rename or delete a venue. Deleting a player removes their stats; saved games keep the name as typed, like a guest's. A short privacy note sits at the bottom of the Players screen. Not built yet: linking a guest in past games to a registered player. Step 7 adds a Tournaments table (games played and won in each live tournament).
- **Guests are allowed.** A name can be typed without registering. Guests play and appear on the scoresheet as normal, and the game is still saved, but guests get no stats page. Later, a guest in a saved game can be linked to a registered player (organiser), which adds those games to that player's stats.
- **Stats page per player:**
  - Games played and won.
  - Average per toad overall and over time.
  - Best game.
  - Head-to-head record.
  - Tournament results.

### 4.4 Saving games
- Single and Duo games are saved when finished. Abandoned games are not counted.
- **Every game records the pub (venue), if one is picked.** It is chosen at setup from a dropdown of the shared venue list, and can be left blank. Only the organiser adds venues, in the Menu (changed 25 Oct 2026; before that anyone could type a new one). The app remembers the last venue used on that phone and pre-selects it.
- Tournaments record their venue once, and all their games inherit it.
- Stats can be filtered by venue, e.g. "Al's average at The Lewes Arms". A venue list also suits a future link-up with the Brighton Pub Guide.
- **Each turn stores:** game, turn index, round, thrower, team (Duo), score, toads thrown, bust flag, points left before the turn, and timestamp.
- Undo removes the last stored turn.
- **Built so far (step 5, Oct 2026):** a finished Single or Duo game is sent whole to `POST /games`, with every turn and its time, the venue and the phone's game id (so a resend is saved once). It waits on the screen while "Undo winning throw" is still possible and is sent when the players play again or change players. With no signal, finished games wait on the phone ("Offline: n games waiting to send") and go when the connection returns. The API replays the scores from 31 and refuses a game that doesn't add up, links registered players and the venue, and writes a summary per registered player for the stats in step 6. Local tournaments are not saved; live tournaments (step 7) save each finished game.

### 4.5 Centralised tournaments
- **Create (organiser only):** name, venue, players (from the list, guests allowed), draw order (list / shuffle), number of tables and a **scoring PIN**.
- **Share:** a public link (e.g. `/toads31/#t-<code>`) plus an on-screen **QR code** to show at the venue.
- **Viewers (no login):** the Tables screen and chalkboard bracket, refreshed every few seconds, with a "last updated" time. Watching is read-only.
- **Scoring:**
  - Someone taps their table and enters the PIN. That phone **claims** the table and becomes its scorer.
  - Other phones see that table live, read-only.
  - A claim can be handed over: release, or take over with the PIN if the scoring phone dies.
- **Concurrency:**
  - Every turn is written with a DynamoDB **conditional write** on the expected turn index. A duplicate or out-of-order submission from another phone is rejected, and that phone refreshes.
  - Match scores, winners and next-round slots are updated in transactions.
- **Phase 1 tournament behaviour is unchanged:** first to 2, byes, tables, a throwing order per game, ambiguous-finish prompt, undo, collapsible Tables section and so on.
- **Organiser controls:** end or reset the tournament, correct a result, release a table.
- **Built in step 7 (Oct 2026):** with the organiser logged in, Tournament mode on the setup screen offers **Run it live**, with a name and a scoring PIN (4 to 8 digits, stored hashed). The tournament gets a 6-character code, a link (`#t-<code>`) and a QR code under **Share**; phones also find it under "Live tournaments" on the setup screen for 3 days. Followers see the Tables screen and bracket, refreshed every 4 s while the page is visible, with "Updated n s ago". **Score this table** asks for the PIN once per phone and claims the table; other phones see "Scored on another phone" with **Watch** (the scoresheet, read-only) and **Take over** (PIN). The scoring phone applies each start, turn and undo with the same rules code as the server (`Toads.applyOp`, copied to `backend/src/lib/rules.cjs`; a test checks the copy) and queues it, so scoring carries on offline ("Offline: n changes waiting to send"). The whole bracket is one DynamoDB item written conditionally on its version, so two tables scoring at once both land, and a stale or duplicate change from another phone is refused or ignored. Each finished game is saved to the players' stats with its tournament; undoing a winning throw takes it out again (only while nothing has started on the back of that result). The organiser can release a table, end the tournament for everyone (results stay visible) or delete it (`DELETE /tournaments/{id}`). Not built: resetting a tournament, and correcting a result other than by undoing the last winning throw.
- **Menu, management and TV screen (24 Oct 2026):** online, a **Menu** button (top right) replaces the Players & stats button at the bottom. It holds Players & stats, **Tournaments**, and the organiser login with venues and **Delete all saved games** (type DELETE to confirm; `DELETE /games?confirm=all`). On a player's stats the organiser can delete one game (`DELETE /games/{id}`, it leaves everyone's stats) or all of that player's games (`DELETE /players/{id}/games`); the list shows the latest 10 with **Show all**. **Tournaments** lists every live tournament (`GET /tournaments?all=1`) with Open and **TV screen** for anyone, and for the organiser Edit (name, venue, tables, new PIN, correct a player's name: `PATCH /tournaments/{id}`), **Restart** from the draw (`POST /tournaments/{id}/restart`; claims are dropped and, unless unticked, its saved games leave the stats), End and Delete (optionally with its games). The **TV screen** (`#tv-<code>`) is a full-screen chalkboard for a big screen: tables in play with live scores and what's coming up on the left, the bracket (and qualifying table) on the right, and at the bottom a QR code to the tournament with "Scan if you want to register the score of a game". It refreshes every 4 s and asks the screen to stay awake. It fits one screen without scrolling (1366×768 up to 1920×1080): text shrinks to fit, "coming up" shows at most 6 matches, the qualifying table splits into two columns, and the QR box is small with "Ask the organiser for the PIN" and the link. Once qualifying is over it shows the bracket, with a small button to switch back to the qualifying table. Each tournament card in the list also shows its match plan: matches per round, the total (2 to 3 games each), about how many per table, and how many are played. Still not built: correcting a single result other than by undo.
- **Qualifying matches per player (25 Oct 2026):** with a qualifying round, setup asks how many qualifying matches each player plays (default 2; 1 to 6, fewer than the players, and an odd number only with an even number of players). Each choice shows the matches per table for the whole tournament. Players meet their nearest neighbours in the draw circle; an odd number adds the player straight across. Sent as `per` on `POST /tournaments`, kept by a restart.
- **Play and ease of use (26 Oct 2026, from the ideas list):**
  - Scoring: the phone stays awake on the game and throwing-order screens; the toad that finishes the game is brass and pulses, and the line says "can finish now"; the turn panel and toads stay at the top of the screen with the chalkboard below (Lionel preferred this to toads at the bottom, 26 Oct 2026); Undo names the turn ("Undo Al's 8"); a live table's game screen says when scores are waiting for a signal; on a win, toads hop up behind the winner, with an optional croak (Menu → "Croak when someone wins", off by default).
  - Menu: a "How to play" card.
  - Setup: "Preview the draw" lists the qualifying or round-1 matches before starting (byes: drawn at random on start).
  - TV: when a table gets a new match, "Al v Bo → Garden" shows in big letters for 12 s.
  - Qualifying table: when two players have the same wins, the column that separated them (+/− or Avg) is underlined.
  - **My matches:** anyone following a live tournament can pick their name (kept on that phone). A line shows their next match ("You're on Garden now: v Bo", "waiting for a table, 2 matches before yours", out, champion…), their card and bracket entries are marked, and the phone buzzes (and croaks if sound is on) when their match gets a table.
  - **A player leaves early** (organiser, Edit): `withdraw` on `PATCH /tournaments/{id}` adds them to `tour.out`. Their matches still to play become walkovers (`wo`, shown "w/o"), a game of theirs in progress is dropped, they drop to the bottom of qualifying and can't go through. Can't be undone.
  - **Set or correct a result** (organiser, Edit): `setResult {ri, mi, winner, wa, wb}` (2–0 or 2–1). Refused while a game is being played on that match, or once a game has started on the back of its result.
- **Venues and tables (25 Oct 2026):** Solo, Duo and Tournament setup pick the venue from a dropdown ("No venue" allowed); the organiser adds venues in the Menu. In a tournament's Edit form each table has a name (blank = "Table n"; `tableNames` on `PATCH /tournaments/{id}`), a **Remove** button while its match hasn't started (`removeTable`: its match goes back in the queue, the phone on it loses it, and table ids don't shift) and **Put back** (`restoreTable`); **Add a table** raises the count. At least one table always stays. Table names show on the phones and the TV screen.

### 4.6 Offline and poor Wi-Fi
- The scoring phone keeps working offline. Turns are queued locally with client-generated IDs so retries are idempotent, then sent in order when the connection returns.
- A clear indicator shows "Offline — n turns waiting to send".
- Viewers show the last known state and its age.

### 4.7 Suggested data model (single DynamoDB table — refine during build)

| PK | SK | Item |
|---|---|---|
| `PLAYERS` | `NAME#<lowercase name>` | Player list entry (id, name) |
| `PLAYER#<id>` | `PROFILE` | Player details |
| `PLAYER#<id>` | `GAME#<timestamp>#<gameId>` | Per-player game summary, for fast stats |
| `GAME#<id>` | `META` | Mode, venue, participants (player IDs or guest names), teams, order, status, winner, tournament/match link |
| `GAME#<id>` | `TURN#<0001>` | One turn (conditional put: must not already exist) |
| `TOURN#<id>` | `META` | Name, venue, tables, PIN hash, status, champion, version counter |
| `VENUES` | `NAME#<lowercase name>` | Venue list entry (id, name, optional area) |
| `TOURN#<id>` | `MATCH#<round>#<index>` | Players, games won, winner, table, current game, scorer claim and expiry |

### 4.8 Suggested API (refine during build)
- **Players:** `GET /players`, `POST /players` (anyone), `PATCH /players/{id}` (organiser), `DELETE /players/{id}` (organiser), `POST /players/{id}/merge` (organiser), `GET /players/{id}/stats?venue=`
- **Venues:** `GET /venues`, `POST /venues` (organiser), `PATCH`/`DELETE /venues/{id}` (organiser)
- **Games:** `POST /games`, `GET /games/{id}`, `POST /games/{id}/turns` (body includes the expected turn index and a client turn ID), `DELETE /games/{id}/turns/last`
- **Organiser:** `POST /auth/organiser` (returns a token)
- **Tournaments:**
  - `POST /tournaments` (organiser)
  - `GET /tournaments/{id}?since=<version>` (public; returns nothing new if unchanged, to keep polling cheap)
  - `POST /tournaments/{id}/tables/{n}/claim` (PIN)
  - `POST /tournaments/{id}/tables/{n}/release`

### 4.9 Security and privacy
- **CORS:** allow only `https://brightonpubguide.co.uk` (plus the test origin).
- **Abuse protection:** API Gateway throttling, and PINs stored hashed.
- **Secrets:** organiser password and secrets live in AWS, never in the repository or the page.
- **Privacy (UK GDPR):** a short privacy notice in the app (what is stored: names and scores), a way to delete a player's data, and minimal data collection.

### 4.10 Cost
- Expected to be pennies a month at pub scale, on pay-per-use Lambda, API Gateway and on-demand DynamoDB. For example, 20 phones polling every 5 s for 3 hours ≈ 43,000 requests.
- Set an **AWS budget alert** of a few pounds.

---

## 5. Deployment (Phase 2)

### 5.1 Repository layout (GitHub, e.g. `toads31`)
```
app/                 static front end (index.html, later js/css, config.js generated at deploy)
backend/template.yaml   AWS SAM template
backend/src/         Lambda handlers
.github/workflows/deploy.yml
REQUIREMENTS.md      this file
```

### 5.2 GitHub Actions workflow
1. **Back end:** build and `sam deploy` the AWS stack. GitHub signs in to AWS through an **OIDC role**, with no stored AWS keys.
2. **Config:** write `config.js` with the API address of that stack.
3. **Front end:** upload `app/` to GoDaddy over **SFTP** (credentials stored as GitHub secrets).

### 5.3 Environments
| Branch | AWS stack | GoDaddy folder |
|---|---|---|
| `test` | `toads31-test` | `/toads31-test` |
| `main` | `toads31` | `/toads31` |

- The `main` deploy waits for manual approval in GitHub before anything goes live (see section 7, decision 8). The approval is a required reviewer on the GitHub environment `live`.
- **Release routine** (`.github/workflows/deploy.yml`, built 23 Oct 2026):
  1. Changes are merged into `test`. The rule tests run, then the app is uploaded to `/toads31-test` automatically.
  2. Check `/toads31-test` on a phone.
  3. Merge `test` into `main`. The tests run again, and the upload to `/toads31` waits for approval under the repository's Actions tab.
  4. After the upload, flush the GoDaddy cache if the page still shows the old version label.
- Each deploy gives the CSS and JS links a new `?v=<run>-<commit>` so phones fetch the new files. Files are uploaded with scripts first and `index.html` last. Only `toads31/` or `toads31-test/` is written and nothing is deleted.
- Started by hand from the Actions tab, the deploy defaults to a dry run (list what would be uploaded), and on any branch other than `test` or `main` it is always a dry run. A manual "SFTP check" workflow lists the server's root folder to test the secrets.
- **Back end in the deploy** (built 23 Oct 2026): the same job first runs `sam deploy` for `backend/template.yaml` (stack `toads31-test` or `toads31`, `Stage` = `test` or `live`). It then writes `config.js` with that stack's `ApiUrl` and checks `GET /health`. Until `AWS_ROLE_ARN` exists, the back end is skipped and `config.js` holds `apiUrl: null`.
- `SFTP_ROOT_PATH` is `html`: the SFTP login opens in the home folder, and `html` inside it holds WordPress.
- **Optional:** use the custom API address `api.brightonpubguide.co.uk`. It needs one DNS record in GoDaddy and a free AWS certificate.
- **One-time setup by Lionel:**
  - Create the AWS account, budget alert and GitHub OIDC role: see [docs/aws-setup.md](docs/aws-setup.md). The role comes from `aws/github-deploy-role.yaml`, and its ARN goes in the GitHub secret `AWS_ROLE_ARN`.
  - Create the GitHub repository.
  - Add the GoDaddy SFTP host, user, password and path as GitHub secrets.
  - Set the organiser password in AWS.

### 5.4 GoDaddy Managed WordPress specifics
- **No cPanel.** File access is by **SFTP** only. The host, username and password are in the GoDaddy dashboard, under the site's settings (look for "SFTP/SSH" or "Server"). The port is usually 22.
- **Upload location:** the site's root folder, the one that contains `wp-admin`, `wp-content` and `wp-config.php`. The app goes into `toads31/` (and `toads31-test/`) inside it. Confirm the exact root path on first connection (it is often shown as `/html` or the site's home folder).
- **Store as GitHub secrets:** `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_PORT` and `SFTP_ROOT_PATH`.
- **Built (Oct 2026): the page updates itself.** Each deploy writes `version.json` with its build number and stamps the same number into `index.html`. On opening, the page fetches `version.json` fresh; if it names a newer build than the page, the page reloads once as `?v=<build>`, an address no cache has stored, so nobody needs to add `?v=` by hand. An `.htaccess` also asks caches to revalidate HTML and JSON.
- **Upload order (24 Oct 2026):** assets first, then `index.html`, then `version.json` last. GoDaddy's Cloudflare CDN caches every file for 31 days and ignores `.htaccess`, so if `version.json` went up first a visit mid-deploy could cache the old page under the new `?v=` address. The page retries its reload once with an extra `&r=` if it still sees an old build.
- **Caching:** Managed WordPress has a server cache and CDN. After each deploy:
  - flush the cache from the GoDaddy dashboard;
  - give the app's own files cache-busting names or query strings, e.g. `app.js?v=<build>`, so phones fetch the new version;
  - keep updating the version label.
- **WordPress is not modified.** No plugin is installed and no WordPress files or database are touched. Only the `toads31*` folders are written.
- **Back end:** nothing in the back end runs on GoDaddy. All server logic is in AWS.

---

## 6. Testing and acceptance
- **Rules (automated tests):**
  - Toads per turn (2/3/4, capped by points left).
  - Keypad range.
  - Bust.
  - Ambiguous-finish prompt and its range.
  - Average per toad, including busts.
  - Duo alternation.
  - Bracket with byes for 2–8 players.
  - Table assignment.
  - Undo and undo-winning-throw.
- **Live tournament:** at least 3 phones. Two tables scoring at once, a viewer following, a phone going offline mid-game and resyncing, and a second phone trying to score a claimed table.
- **Every release:**
  - Test on `/toads31-test` first.
  - Bump the version label.
  - Check it at phone width in light and dark mode.

---

## 7. Open decisions
1. ~~GoDaddy plan~~ **Decided: GoDaddy Managed WordPress.** See section 5.4.
2. **Decided:** anyone can add players. The organiser can tidy up (rename, merge, delete).
3. **Decided:** a single organiser password is enough.
4. **Decided:** every game records the pub/venue (shared list, optional; only the organiser adds venues since 25 Oct 2026).
5. **Decided:** guest names are allowed. Their games are saved, but guests get no stats unless later linked to a registered player.
6. **Decided:** when the player count is not a power of two, the organiser chooses between a **Qualifying round** and **Byes** (round 1 only, random). Built into the app on 22 Oct 2026; see section 3.1.
7. **Decided (23 Oct 2026):** if the API cannot be reached, the app falls back to Phase 1 local mode so a game never stops.
8. **Decided (23 Oct 2026):** deploys to live (`main` → `/toads31`) need manual approval in GitHub (a protected GitHub environment). Deploys to `test` run automatically.
9. **Decided (23 Oct 2026):** use the default AWS API address for now; the custom `api.brightonpubguide.co.uk` address can come later.
10. **Decided (23 Oct 2026):** live updates use polling every 3–5 s; WebSockets only if polling proves too slow.
11. **Decided (23 Oct 2026):** players and win tallies already stored in phones' `localStorage` are not migrated. Players are registered fresh in the shared list.
