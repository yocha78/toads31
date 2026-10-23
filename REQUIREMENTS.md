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

One self-contained `index.html` with no back end. State is kept in the browser's `localStorage` under the key `toads31`, and survives reloads.

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
  - **Opponents:** players sit in a circle in draw order, and each plays the two players either side. Everyone plays exactly **2 matches**, each first to 2 games. With 3 players this is everyone against everyone.
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
- **Keypad:** compact, 5 columns.
- **Messages:** after each turn, e.g. "Al scores 4." or "Bust! Al stays on 5." In Duo: "Di scores 4 for Hole Lotta."
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
- The file is uploaded by hand as `public_html/toads31/index.html` on GoDaddy. It sits next to WordPress; real folders bypass WordPress routing.
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
- **Guests are allowed.** A name can be typed without registering. Guests play and appear on the scoresheet as normal, and the game is still saved, but guests get no stats page. Later, a guest in a saved game can be linked to a registered player (organiser), which adds those games to that player's stats.
- **Stats page per player:**
  - Games played and won.
  - Average per toad overall and over time.
  - Best game.
  - Head-to-head record.
  - Tournament results.

### 4.4 Saving games
- Single and Duo games are saved when finished. Abandoned games are not counted.
- **Every game records the pub (venue).** It is chosen at setup from a shared list of venues, with a type-ahead search. Anyone can add a venue. The app remembers the last venue used on that phone and pre-selects it.
- Tournaments record their venue once, and all their games inherit it.
- Stats can be filtered by venue, e.g. "Al's average at The Lewes Arms". A venue list also suits a future link-up with the Brighton Pub Guide.
- **Each turn stores:** game, turn index, round, thrower, team (Duo), score, toads thrown, bust flag, points left before the turn, and timestamp.
- Undo removes the last stored turn.

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
- **Venues:** `GET /venues`, `POST /venues` (anyone), `PATCH`/`DELETE /venues/{id}` (organiser)
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

- **Optional:** use the custom API address `api.brightonpubguide.co.uk`. It needs one DNS record in GoDaddy and a free AWS certificate.
- **One-time setup by Lionel:**
  - Create the AWS account, budget alert and GitHub OIDC role (step-by-step instructions to be provided).
  - Create the GitHub repository.
  - Add the GoDaddy SFTP host, user, password and path as GitHub secrets.
  - Set the organiser password in AWS.

### 5.4 GoDaddy Managed WordPress specifics
- **No cPanel.** File access is by **SFTP** only. The host, username and password are in the GoDaddy dashboard, under the site's settings (look for "SFTP/SSH" or "Server"). The port is usually 22.
- **Upload location:** the site's root folder, the one that contains `wp-admin`, `wp-content` and `wp-config.php`. The app goes into `toads31/` (and `toads31-test/`) inside it. Confirm the exact root path on first connection (it is often shown as `/html` or the site's home folder).
- **Store as GitHub secrets:** `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_PORT` and `SFTP_ROOT_PATH`.
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
4. **Decided:** every game records the pub/venue (shared list, anyone can add).
5. **Decided:** guest names are allowed. Their games are saved, but guests get no stats unless later linked to a registered player.
6. **Decided:** when the player count is not a power of two, the organiser chooses between a **Qualifying round** and **Byes** (round 1 only, random). Built into the app on 22 Oct 2026; see section 3.1.
