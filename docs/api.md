# Coalition app endpoint contract

What `app.coalitionracing.com` needs to implement to receive reports from the
extension. Nothing here is built yet on the app side — this is the contract the
extension already speaks.

## Request

```
POST {baseUrl}{path}          default: https://app.coalitionracing.com/api/wtrl/team-report
Content-Type: application/json
Authorization: Bearer <api-key>       (or  X-API-Key: <api-key>)
```

Body is the full report object — see the Output section of the
[README](../README.md). The fields an importer will care about:

| Field                    | Type     | Notes                                              |
| ------------------------ | -------- | -------------------------------------------------- |
| `generatedAt`            | ISO 8601 | When the report was built, in UTC                  |
| `extensionVersion`       | string   | Sending extension version                          |
| `source`                 | string   | `"wtrl.racing/zrl/myteams"`                        |
| `teamCount`/`riderCount` | number   | Counts, for a cheap sanity check                   |
| `failures`               | array    | Teams that could not be read — **see below**       |
| `teams`                  | array    | Nested teams, each with its own `riders`           |
| `riders`                 | array    | Flat rows, each tagged with `teamName` and `trc`   |

`teams` and `riders` carry the same rider data in two shapes; use whichever
suits. Do not treat them as two different datasets.

### Connection test

The Settings page's **Test connection** button posts a probe with the same auth
headers:

```json
{
  "generatedAt": "…",
  "source": "extension-connection-test",
  "extensionVersion": "0.1.0",
  "test": true,
  "teamCount": 0,
  "riderCount": 0,
  "teams": [],
  "riders": []
}
```

Check for `test === true` and return `200` without writing anything.

## Response

Any `2xx` is treated as success; the body is shown to the user (first 2000
chars), so a short JSON summary is useful:

```json
{ "ok": true, "teamsImported": 2, "ridersImported": 8 }
```

Non-2xx is surfaced as `HTTP <status>: <first 300 chars of body>`. Put the
reason in the body — it is the only thing the user will see.

## Implementation notes

### Identity

- `zwid` is the Zwift profile id. It is the right key to join against Zwift data
  and against ZwiftPower.
- `userId` is WTRL's own UUID, stable for a rider across teams and seasons.
- `tmuid` identifies a rider's *membership of one team*, not the rider. It
  changes if they leave and rejoin. Do not use it as a person key.
- `trc` identifies a team's entry in one competition round. `teamId` is the
  longer-lived team id.

A rider on two of your teams appears once per team: same `zwid` and `userId`,
different `tmuid` and `teamName`.

### Partial reports

`failures` is non-empty when some teams could not be read. Those teams are absent
from `teams` entirely — so a naive "replace everything for this user" import will
delete riders that are merely missing from a partial report. Either reject
reports with failures, or reconcile per-team using `trc`:

```js
if (report.failures.length) {
  return { ok: false, error: 'Partial report — resend when all teams load.' };
}
```

### Trust

The report is client-supplied: it comes from a browser extension running on a
user's machine, and its contents are whatever WTRL returned to that user. Treat
it as untrusted input — validate the shape, scope the write to whatever teams the
API key is authorised for, and do not let a report create teams the key does not
own.

### CORS

The request comes from the extension's own origin, so the browser sends
`Origin: chrome-extension://<id>` and preflights the `Authorization` header.
Either allow that origin explicitly:

```
Access-Control-Allow-Origin: chrome-extension://<extension-id>
Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key
Access-Control-Allow-Methods: POST, OPTIONS
```

…or grant the extension host permission for the origin, which is what the
**Connect** button does — with host permission, Chrome exempts the extension's
requests from CORS and no `Access-Control-*` headers are needed. The Connect
flow is the supported path; the headers above are only needed if you would
rather not grant it.

### Keys

Issue one key per manager. The extension stores the key in
`chrome.storage.local` and reads it only in the background service worker — it is
never present in the wtrl.racing page context. It is still a bearer credential on
a user's machine, so scope keys narrowly and make them revocable.
