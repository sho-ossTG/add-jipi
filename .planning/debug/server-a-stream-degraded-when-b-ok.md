---
status: verifying
trigger: "TRY TO DO DEBUGGER"
created: 2026-02-22T18:37:37Z
updated: 2026-02-22T18:39:09Z
---

## Current Focus

hypothesis: Confirmed - strict broker parser caused false degraded fallback when broker returned non-`data.url` payload shape
test: Validate resolver compatibility with alternate payload shape and run stream reliability contracts
expecting: Resolver should extract playable URL from links/nested fields and avoid degraded fallback for healthy broker responses
next_action: user-side deploy verification in live Stremio flow

## Symptoms

expected: Clicking a supported episode in Stremio returns a playable stream link from Server B.
actual: Stream request returns degraded message "Stream source is temporarily unavailable. Please retry shortly."
errors: User-facing degraded notice; no playable link returned by Server A despite Server B being healthy.
reproduction: Request supported stream endpoint on Server A (e.g., `/stream/series/tt0388629:...json`) and observe degraded notice.
started: After recent Server A changes.

## Eliminated

## Evidence

- timestamp: 2026-02-22T18:37:59Z
  checked: user report and runtime symptom context
  found: failure is isolated to Server A behavior while Server B reportedly healthy
  implication: likely regression in Server A request-control, broker-call parsing, or response mapping path

- timestamp: 2026-02-22T18:38:26Z
  checked: `modules/integrations/broker-client.js`
  found: previous resolver accepted only `data.url` and threw `Broker returned missing url` otherwise
  implication: healthy broker responses with alternate shapes (e.g., links arrays) were misclassified as unavailable

- timestamp: 2026-02-22T18:38:26Z
  checked: patched resolver + regression test `broker resolve accepts links-array payload shape`
  found: URL extraction now supports direct, nested, and links-array fields; local contract suite passed (`node --test tests/contract-stream-reliability.test.js`)
  implication: Server A now returns playable stream when broker payload is valid but non-legacy shape

- timestamp: 2026-02-22T18:39:09Z
  checked: git history
  found: fix committed as `1d6440d fix(stream): accept broker link payload variants`
  implication: patch is recorded and deployable for live verification

## Resolution

root_cause:
  Broker integration in Server A was overly strict and required `response.json().url`; when Server B returned a different valid payload shape, Server A threw and sent degraded fallback.
fix:
  Updated broker resolver to accept multiple URL/filename shapes (direct, nested, links-array variants) and added regression coverage for links-array payload responses.
verification:
  Local verification passed via `node --test tests/contract-stream-reliability.test.js` after adding compatibility parser and regression test.
files_changed:
  - modules/integrations/broker-client.js
  - tests/contract-stream-reliability.test.js
