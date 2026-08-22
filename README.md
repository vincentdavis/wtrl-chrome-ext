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

1. Download `wtrl-zrl-team-report-vX.Y.Z.zip` from the
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
3. Press **Build report**.

The panel walks your teams one at a time and shows progress. When it finishes,
**Open table** gives you the full roster view, or you can **Copy JSON**,
**Download JSON**, **Download CSV**, or **Send to Coalition**. The extension's
toolbar popup does the same thing and keeps the last report so you can come back
to it later.

Tick **Include rider stats** to keep category, zFTP, zMAP, points and appearances
in the JSON/CSV export. (The table always has them — the toggle only changes what
gets exported.)

## Table view

**Open table** opens the whole roster in one sortable, filterable table.

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
- **Export view (CSV)** saves exactly the rows you are looking at, filters and
  sort included — handy for chasing a specific group.

A partial report (some team failed to load) shows a banner naming the teams that
are missing, so the table is never quietly incomplete.

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
  ]
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
| `https://*.wtrl.racing/*`     | Read your teams on the My Teams page                        |
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
| `src/results.*`         | Table view: search, filter, sort, group by team                 |
| `src/popup.*`           | Toolbar popup                                                   |
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

**A team times out.** Open **Activity log** in the panel. If direct fetches are
failing, go to Settings → **Forget template** and run the report again to
relearn the endpoint.

**The Report button is missing.** Reload the page. The button is injected once
the team accordion appears.

**Race counts are all zero.** WTRL reports `appearancesRound` and
`appearancesSeason`; both are 0 before a season's racing starts.

## License

MIT — see [LICENSE](LICENSE).
