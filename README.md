# WTRL ZRL Team Report

A Chrome extension for [wtrl.racing](https://www.wtrl.racing/). On your
**My Teams** page it adds a **Report** button that opens every one of your teams,
collects the riders from each, and gives you a single JSON or CSV file — instead
of clicking through each team by hand.

Built for [The Coalition](https://app.coalitionracing.com), but it works for any
WTRL ZRL team manager.

---

## Install

Not on the Chrome Web Store — install it unpacked:

1. Download `wtrl-zrl-team-report-v0.11.0.zip` from the
   [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and pick the unzipped folder.

To upgrade, download the new zip and repeat — Chrome does not auto-update
unpacked extensions.

> Works in any Chromium browser with Manifest V3: Chrome, Edge, Brave, Arc, Opera.

## Use

1. Go to <https://www.wtrl.racing/zrl/myteams/> and sign in.
2. Click the red **Report** button in the bottom-right corner.

That's the whole flow. The button opens your report. If you haven't built one
yet it starts building, opens the report as soon as the first team lands, and
fills the rest in live while you read.

Everything else lives in the **toolbar popup** (the extension icon next to the
address bar): JSON and CSV export, copy to clipboard, and Send to Coalition.

| Where | What you get |
| ----- | ------------ |
| **Report** button on the page | Opens the report; builds it first if there isn't one |
| **Report** table → *Refresh* | Re-reads every team from WTRL |
| **Toolbar popup** | Open report, rebuild, and all exports (JSON / CSV / copy / send) |

## The report

The report is a sortable, filterable table of every rider across all your teams.

- **Grouped by team** by default, with each team's division and counts in its
  header row. Untick to get one flat list with a Team column.
- **Search** across name, Zwift id, user id and team. Press `/` to jump to the
  box, `Esc` to clear it.
- **Filters** for team, membership status, sign-up state and races this season,
  plus a **multi-team only** toggle.
- **Sort** on any column — click a header, click again to reverse. Numeric
  columns start highest-first.
- **Stat tiles** across the top double as one-click filters: *Invited, pending*
  jumps straight to riders who have been invited but have not accepted;
  *Not signed up*, *No races yet*, and *On 2+ teams* work the same way.
- **Race counts** per rider for the current round and the season so far.
- Riders on more than one of your teams carry a **multi-team** badge — matched on
  `zwid`, so it catches the same person across different teams.
- Pending invites are tinted amber and flagged in each team's header.
- **zwid** links out to that rider's ZwiftPower profile.
- **Fills in live.** Each team is saved the moment it is read, so the table
  grows in front of you and a progress banner tracks how far along the run is.
  Refresh and Retry are disabled while a run is in flight.
- **Nothing is lost if a run is interrupted.** Close the tab at team 19 of 21
  and the 18 already collected are still there — the table says the build was
  interrupted and offers to finish it, rather than starting from nothing.
- **Retry failed teams** appears in the partial-report banner when some teams
  could not be read. It re-reads only those teams and folds them into the report
  you already have, so 18 good teams don't get thrown away to recover 3.
- **Refresh** re-reads every team from WTRL without leaving the table. It reuses
  an open My Teams tab, or quietly opens one in the background and closes it
  again afterwards. Your filters and sort survive the refresh.
- **Export view (CSV)** saves exactly the rows you are looking at, filters and
  sort included — handy for chasing a specific group. Whole-report JSON and CSV
  live in the toolbar popup.

A partial report (some team failed to load) shows a banner naming the teams that
are missing, so the table is never quietly incomplete.

While a run is in flight the report carries `inProgress: true` and a
`{ done, total }` counter; both are gone once it finishes, so exports and uploads
are unaffected.

Tick **Include rider stats** in the popup to keep category, zFTP, zMAP, points
and race counts in the JSON/CSV export. The table always shows them — the toggle
only changes what gets exported.

## ZwiftPower roster enrichment

In the report table, **Add ZwiftPower** pulls your club's ZwiftPower roster and
matches it onto your riders. `zwid` is the same number on both sides, so this is
an exact join — no name matching — and the whole club arrives in a single
request rather than one per rider.

Each rider gains their ZwiftPower **category**, FTP, weight, 20-minute and
15-second w/kg, ranking and racing score, as new columns beside the WTRL ones.

The point of putting them side by side is the disagreements. WTRL assigns ZRL
categories from zFTP/zMAP; ZwiftPower ranks on its own results. When they differ
the cell turns amber and says which is which — a rider sitting in your C team
while ZwiftPower has them at B is exactly what you want to see before a race.
The **Cat mismatch** tile filters to just those.

The club ID is detected from your own ZwiftPower account, and can be overridden
in Settings to pull a different club.

Two things worth knowing about the data:

- **Coverage is partial.** Across a real 2,084-member club, FTP was present for
  2,053 riders but ranking for only 745 and 20-minute power for 1,189. Missing
  readings show as `—`, never as `0`.
- **Rider emails are never read.** The club roster payload carries an `email`
  field for every member. It is dropped at the bridge and appears nowhere in the
  report, the exports or the upload.

A rider who is on a WTRL team but not in the ZwiftPower club is reported, not
silently skipped.

## Race power profiles

On <https://www.wtrl.racing/zrl/results/>, pick a league, division and round,
then press the **Power** button. You get every rider in that race with their
ZwiftPower power curve beside their ZRL result.

WTRL's results API zeroes out `zwid` and abbreviates names (`S. Joneström`), so
it cannot be joined to ZwiftPower directly. What it does carry is `zid`, the
Zwift event id — and ZwiftPower publishes the same event with real Zwift ids and
full power data. So `zid` is the bridge, and riders are matched by surname plus
first initial *within that one event*, which is a small enough pool to be
reliable. On a real race this matched 18 of 19 riders; the one miss simply has no
ZwiftPower row for that event, and is reported rather than guessed at.

It covers **every rider in the race**, not just your own team — the whole
division's field, each team side by side.

### Team view

A **Team / Rider** toggle mirrors WTRL's own. Team view puts WTRL's scoring
(position, FAL/FTS/FIN/PBP, total) next to ZwiftPower averages for the same
team: average w/kg at 20m, 5m, 1m and 15s, best 20-minute effort, average FTP
and weight, and the category mix. Click any team to expand its riders inline.

Averages count **only riders who matched a ZwiftPower row**, so a team is not
quietly dragged down by counting a missing rider as zero. The **Power** column
shows the coverage (`2/3`) and turns amber when it is partial, so a thin average
is visible rather than misleading.

**Export view (CSV)** follows the toggle: team aggregates in team view, riders
in rider view.

### Colours

Each column is shaded on its own scale — a 5s w/kg and a 20m w/kg are not
comparable numbers, so one scale across both would be meaningless. The
**Shading** picker offers:

| Palette | Colour-blind safe |
| --- | --- |
| Viridis (default) | Yes, perceptually even |
| Red → green | **No** — this is the pairing deuteranopia and protanopia cannot separate |
| Cividis | Yes, designed for colour-blind viewers |
| Blue → orange | Yes, diverging |
| Monochrome | Yes, lightness only |
| No shading | — |

Unsafe palettes are marked with `*` in the picker. Every safe palette also runs
monotonically from dark to light, so the ranking survives without colour vision
at all — a test asserts that, and that each palette holds at least 3:1 text
contrast across its range (heat cells render at 14px bold, where that is the
WCAG AA bar) and 4.5:1 at the ends. Your choice is remembered.

Weight is never shaded: heavier is not better, so a colour scale on it would
imply a ranking that does not exist.

### Rider view

Per rider:

- **ZRL points** for the race — FAL (first across the line), FTS (fastest
  through segment), FIN (finish), PBP and the total, shaded like the power
  columns. These sum exactly to WTRL's team row, so team view reconciles with
  the riders underneath it. A round that has not been finalised reports zero
  across the board, which is WTRL's own answer rather than missing data.

- **Power curve** at 5s, 15s, 30s, 1m, 2m, 5m and 20m, in w/kg or watts, shaded
  as a heatmap so a standout effort is visible down a column. ZwiftPower's own
  personal-best flag is marked with a star.
- Weight, race FTP, normalised power, average w/kg, category, and whether the
  rider is **verified** (ZADA).
- Their ZRL team from WTRL, next to their club from ZwiftPower.
- **Click any rider** for their career bests at every duration, fetched on
  demand, with this race's numbers alongside — so you can see at a glance
  whether someone just rode well above their own history.

WTRL sends rider categories numerically (`10`, `20`) on the same scale as
ZwiftPower's divisions; both are shown as letters so a team's category mix reads
consistently whether or not a rider matched.

Riders with no ZwiftPower row are listed in a banner and kept in the table
(greyed out) rather than dropped, so the field is never quietly incomplete.

**This needs you signed in to ZwiftPower.** Its endpoints return `403` to
anyone without a session, and an extension's own requests don't carry one. The
extension borrows a `zwiftpower.com` tab instead — reusing one you already have
open, or opening one in the background and closing it again.

## Output

```jsonc
{
  "generatedAt": "2026-08-22T12:00:00.000Z",
  "source": "wtrl.racing/zrl/myteams",
  "extensionVersion": "0.1.0",
  "teamCount": 2,
  "riderCount": 8,
  "failures": [],

  // Nested: one entry per team, riders underneath.
  "teams": [
    {
      "teamName": "COALITION ANNIHILATION",
      "trc": 76720,
      "teamId": 8783,
      "division": "Open Orange League B",
      "racingSeason": "2026/27",
      "season": 20,
      "round": 1,
      "competitionDivision": "B",
      "competitionClass": "2250B0",
      "registrationStatus": "REGISTERED",
      "memberCount": 6,
      "riders": [
        {
          "name": "Chad D. Peddicord",
          "zwid": 38810,
          "memberStatus": "MEMBER",
          "signedup": false,
          "userId": "798c9567-d1cf-4afb-b382-e269d80ad37c",
          "tmuid": 457469,
          "teams": 0
        }
      ]
    }
  ],

  // Flat: one row per rider per team, each tagged with its team. This is what
  // the CSV export contains.
  "riders": [
    {
      "teamName": "COALITION ANNIHILATION",
      "trc": 76720,
      "name": "Chad D. Peddicord",
      "zwid": 38810,
      "memberStatus": "MEMBER",
      "signedup": false,
      "userId": "798c9567-d1cf-4afb-b382-e269d80ad37c",
      "tmuid": 457469,
      "teams": 0
    }
  ],

  // Present only after "Add ZwiftPower". `roster` holds the raw ZwiftPower rows
  // for riders in this report, keyed by zwid, so a server can redo the join
  // itself rather than trusting the extension's.
  "zwiftpower": {
    "teamId": 11991,
    "teamName": "COALITION",
    "fetchedAt": "2026-10-19T09:00:00.000Z",
    "rosterSize": 2084,
    "matched": 6,
    "missing": [],
    "roster": [
      { "zwid": 38810, "zpCategory": "B", "zpFtpW": 242, "zpWeightKg": 76.2,
        "zpRank": 240.83, "zpSkill": 7062, "zp20minWkg": 3.5, "zp15sWkg": 8.5 }
    ]
  }
}
```

### Rider fields

| Field          | Source              | Notes                                                     |
| -------------- | ------------------- | --------------------------------------------------------- |
| `name`         | `name`              | Display name as WTRL has it                                |
| `zwid`         | `profileId`         | Zwift profile id — the same id Zwift uses                  |
| `memberStatus` | `memberStatus`      | `MEMBER`, `INVITED`, … — invited riders are **kept**       |
| `signedup`     | `signedup`          | Signed up for the next race                                |
| `userId`       | `userId`            | WTRL user UUID, stable across teams                        |
| `tmuid`        | `tmuid`             | Team-membership id — unique per rider *per team*           |
| `teams`        | `teams`             | How many teams this rider is on                            |
| `teamName`     | `meta.team.name`    | Flat rows only                                             |
| `trc`          | `meta.trc`          | Flat rows only — WTRL's team-race-competition id           |

With **Include rider stats** on, each rider also gets `category`, `zftp`,
`zftpw`, `zmap`, `zmapw`, `riderpoints`, `appearancesRound`, `appearancesSeason`
and `avatar`. The `zftp`/`zmap` floats are rounded to 2 decimals — WTRL returns
them at full binary precision (`3.5600000000000000532…`).

A rider who is on two of your teams appears once per team, with a different
`tmuid` each time and the same `zwid`/`userId`.

Teams that could not be read land in `failures` rather than silently vanishing,
so a partial report is always obvious:

```json
"failures": [{ "trc": 76637, "teamName": "COALITION DELUSION", "error": "Timed out waiting for team data" }]
```

## How it collects the data

WTRL loads a team's riders over the network when you expand its accordion panel.
Rather than hardcode a guess at that endpoint (which would break the moment WTRL
changes it), the extension learns it:

1. A `MAIN`-world script wraps `fetch` and `XMLHttpRequest` on the page and
   watches for a JSON response shaped like a team payload
   (`{ meta: { trc }, riders: [] }`).
2. The extension expands the **first** team's panel, letting the site make its own
   request, and captures the response — including the URL it came from.
3. That URL becomes a template: `…?trc={trc}&season={season}`.
4. Every remaining team is fetched directly from the template — no clicking, and
   much faster.

The template is cached, so later runs skip step 2 entirely. If a direct fetch
fails, the extension falls back to expanding that team's panel. Panels are
restored to whatever expanded/collapsed state you left them in.

### Being a good citizen with a long roster

A big roster is a burst of sequential requests, and WTRL starts refusing or
stalling part-way through one. The extension handles that rather than dropping
teams:

- **Transient failures are retried** up to three times — timeouts, network
  errors, `429 Too Many Requests`, and `5xx`. A `404`, or a response that isn't a
  team payload (an expired session redirecting to a login page), is treated as
  permanent and not retried.
- **Backoff grows** between attempts (2s, then 4s), and a `Retry-After` header is
  honoured over that if the server sends one.
- **The whole run slows down** when the server shows strain, then eases back up
  as teams start succeeding again — so one bad patch doesn't cascade.
- **Failures record the HTTP status**, not just "timed out", so the Activity log
  says what actually happened.
- Anything still failing can be picked up later with **Retry failed teams**
  instead of rebuilding everything.
- **Every team is saved as it arrives**, so a run that is interrupted keeps
  everything collected up to that point.

Raise **Request timeout** in Settings if you manage many teams or your connection
is slow.

Nothing is scraped out of rendered HTML, so cosmetic changes to WTRL's markup do
not break the report.

## Sending to the Coalition app

Open **Settings** (from the panel footer or the popup) to point the extension at
`app.coalitionracing.com`:

- **Base URL** / **Endpoint path** — where to POST.
- **API key** — stored in extension storage and read **only** by the background
  service worker. It is never injected into the wtrl.racing page, so nothing
  running on WTRL's site can read it.
- **Auth header** — `Authorization: Bearer <key>` or `X-API-Key: <key>`.
- **Connect** — grants the extension permission to talk to that origin. This is
  an *optional* permission requested at the moment you press the button, so the
  extension ships without any standing access to the Coalition app.
- **Test connection** — POSTs a small probe payload (`"test": true`).

See [`docs/api.md`](docs/api.md) for the request contract the receiving endpoint
needs to implement.

## Permissions

| Permission                    | Why                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| `https://*.wtrl.racing/*`     | Read your teams and race results                            |
| `https://zwiftpower.com/*`    | Read power data for a race, using your signed-in session    |
| `storage`                     | Settings, the learned endpoint template, the last report    |
| `downloads`                   | Save the JSON/CSV file                                      |
| `app.coalitionracing.com` *(optional)* | Only if you enable upload, only when you press Connect |

The extension talks to wtrl.racing and — if you configure it — the Coalition app.
Nowhere else. No analytics, no telemetry.

## Development

No dependencies. Node 18+ for the tooling, Python 3 to regenerate icons.

```bash
npm test        # unit tests for the report logic
npm run check   # validate manifest references + run tests
npm run build   # check, then package dist/*.zip + .sha256
npm run mock    # local stand-in for the WTRL My Teams page, on :8787
npm run icons   # regenerate icons/ from scripts/make-icons.py
```

`npm run mock` serves a fake My Teams page that loads the real content script
against the real fixtures — useful for working on the collection flow without a
WTRL login. Its team endpoint deliberately lives at a URL the extension has never
seen, so a successful run proves the endpoint is genuinely discovered rather than
hardcoded.

Load the repo root directly with **Load unpacked** while developing — no build
step is needed to run it.

| Path                    | What it is                                                     |
| ----------------------- | -------------------------------------------------------------- |
| `manifest.json`         | MV3 manifest                                                    |
| `src/interceptor.js`    | `MAIN`-world network interceptor (endpoint discovery)           |
| `src/content.js`        | Team discovery, orchestration, on-page UI                       |
| `src/report-format.js`  | Pure report shaping + CSV — shared, and unit-tested             |
| `src/background.js`     | Service worker: downloads, upload, API key custody              |
| `src/settings.js`       | Settings schema shared by the worker, popup and options page    |
| `src/results.*`         | The report table: search, filter, sort, group, refresh          |
| `src/race-format.js`    | ZwiftPower joins: roster enrichment, power curves — unit-tested |
| `src/race-content.js`   | Content script on the WTRL results page                         |
| `src/race.*`            | The race power table                                            |
| `src/zp-bridge.js`      | Content script on zwiftpower.com, fetches with your session     |
| `src/popup.*`           | Toolbar popup: open/rebuild plus every export                   |
| `src/options.*`         | Settings page                                                   |
| `scripts/build.mjs`     | Dependency-free, reproducible ZIP packer                        |
| `scripts/validate.mjs`  | Manifest/HTML reference checks + JS parse checks                |
| `test/`                 | Unit tests over the real payload shape                          |
| `test/mock/`            | Browser harness: fake My Teams page + server                    |

### Releasing

CI validates and packages every push. To publish a downloadable build:

```bash
npm run set-version 0.2.0
git commit -am "Release v0.2.0" && git tag v0.2.0 && git push --follow-tags
```

The tag triggers [`.github/workflows/build.yml`](.github/workflows/build.yml),
which checks the tag matches `manifest.json`, packages the extension, and
publishes a GitHub Release with the zip, its `.sha256`, and install instructions.
Every other push uploads the same zip as a build artifact.

## Troubleshooting

**"No teams found on this page."** You need to be on
<https://www.wtrl.racing/zrl/myteams/> and signed in. If the page is still
loading the accordion, wait a moment and press **Build report** again.

**Add ZwiftPower can't work out my club.** It reads the club from the "Team"
link on your signed-in ZwiftPower page. If your account has no club, or you want
a different one, set the ID in Settings → ZwiftPower.

**A rider has no ZwiftPower columns.** They are not in the club roster, which is
listed after enrichment. Blank individual cells mean ZwiftPower simply has no
reading for them — ranking and power are only populated for a fraction of a
typical club.

**Power says ZwiftPower refused the request.** ZwiftPower returns `403` without
a session. Open <https://zwiftpower.com>, sign in, and press **Power** again.

**A rider has no power data.** They have no row in ZwiftPower for that event —
usually no recorded activity, or ZwiftPower has not matched them to it. They stay
in the table, greyed out, and are named in the banner.

**The table says "Build was interrupted".** The WTRL tab was closed or navigated
away mid-run. Everything collected up to that point is kept — press **Refresh**
to finish the job, or **Retry failed teams** if only a few are missing.

**Some teams time out on a big roster.** Transient failures are retried
automatically with backoff, and the run slows itself down under strain. If teams
still fail, open the report and press **Retry failed teams** in the banner — it
re-reads only those teams and keeps the ones you already have. Raising
**Request timeout** in Settings (default 30s) helps on slow connections.

**A team fails every time.** Open **Activity log** in the build panel and read
the status. A `404` or "not a team payload" usually means the endpoint moved or
your session expired — go to Settings → **Forget template**, reload My Teams so
you are definitely signed in, and rebuild to relearn the endpoint.

**The Report button is missing.** Reload the page. The button is injected once
the team accordion appears.

**Refresh says it can't reach the My Teams page.** It needs a signed-in WTRL
session. Open <https://www.wtrl.racing/zrl/myteams/>, confirm your teams are
listed, then refresh again.

**Race counts are all zero.** WTRL reports `appearancesRound` and
`appearancesSeason`; both are 0 before a season's racing starts.

## License

MIT — see [LICENSE](LICENSE).
