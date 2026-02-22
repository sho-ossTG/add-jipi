# Phase 6 - Manual Verification: Stremio Install/Browse/Playback

**Purpose:** Validate live Stremio client behavior in a real environment.
**Execution constraint:** Do not run these steps from this machine during planning/execution automation.

## Preconditions

- Tester machine has network access and can reach `$ADDON_BASE_URL`.
- Deployed addon base URL is known and exported on tester machine:

```bash
export ADDON_BASE_URL="https://<your-deployed-addon-domain>"
```

- Stremio desktop client is installed on tester machine.
- A supported episode ID is available (example: `tt0388629:1:1089`).
- Tester can capture screenshots and copy terminal output.

## Baseline Commands (run on tester machine)

Run each command and keep full output for evidence.

```bash
# 1) Manifest reachability and protocol shape
curl -i "$ADDON_BASE_URL/manifest.json"

# 2) Catalog shape check
curl -i "$ADDON_BASE_URL/catalog/series/top.json"

# 3) Stream endpoint shape check for supported episode
curl -i "$ADDON_BASE_URL/stream/series/tt0388629:1:1089.json"
```

Expected command outcomes:

- Each request returns HTTP `200`.
- `manifest.json` returns valid JSON with Stremio manifest fields.
- Catalog endpoint returns valid JSON with a non-error catalog payload.
- Stream endpoint returns valid JSON with stream data or deterministic fallback shape (no malformed payload).

## Manual Checklist (Stremio UI)

1. Open Stremio.
2. Go to Addons -> Add addon from URL.
3. Enter `$ADDON_BASE_URL/manifest.json` and submit.
4. Confirm addon installs successfully with no manifest/protocol error dialog.
5. Open the addon catalog and verify expected series entries are visible.
6. Open a supported episode and verify stream options appear.
7. Start one stream and confirm playback begins or transitions to expected player state.
8. Verify no client-visible contract/protocol errors appear during install, browse, or playback flow.

## Expected Outcomes

- Addon installation succeeds in Stremio.
- Catalog browse shows expected data from addon.
- Supported episode produces stream options.
- Playback flow starts without protocol-shape failures.
- Any degraded behavior is user-readable and non-crashing.

## Evidence Capture

Collect all evidence artifacts for the run:

- Terminal output for all three baseline `curl` commands.
- Screenshot of successful addon installation.
- Screenshot of catalog view populated by addon.
- Screenshot of stream selection and playback start (or expected degraded message).

## Evidence Log Template

- Date/time:
- Tester:
- Environment (OS/device):
- Addon URL (`$ADDON_BASE_URL`):
- Stremio version:
- Supported episode ID tested:
- Command results summary:
- UI verification summary:
- Result: PASS | FAIL
- Notes:
