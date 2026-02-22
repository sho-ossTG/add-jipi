# Phase 6 - Manual Verification: Broker/Redis Outage Behavior

**Purpose:** Validate live dependency-failure behavior and policy-denied behavior with deterministic pass/fail checks.
**Execution constraint:** This runbook is manual-only and must be executed from a network-enabled tester machine (not this planning executor host).

## Preconditions

- `ADDON_BASE_URL` is set to the deployed target environment.
- `STREAM_PATH` is a supported stream request path. Default: `/stream/series/tt0388629:1:1089.json`.
- Operator has outage toggles or equivalent controls to induce each scenario:
  - broker timeout,
  - broker unavailable,
  - Redis timeout,
  - Redis unavailable,
  - capacity full or shutdown-window deny.
- Optional diagnostics access is prepared (`OPERATOR_TOKEN`) for `/health/details` and `/operator/metrics`.
- Evidence destination is prepared (ticket, document, or incident record).

## Commands (run on tester machine)

```bash
# Required request used for all scenarios
curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"

# Optional diagnostics (if OPERATOR_TOKEN is available)
curl -sS -D - -H "Authorization: Bearer $OPERATOR_TOKEN" "$ADDON_BASE_URL/health/details"
curl -sS -D - -H "Authorization: Bearer $OPERATOR_TOKEN" "$ADDON_BASE_URL/operator/metrics"
```

## Scenario Matrix

Use this matrix one row at a time. Always reset to healthy baseline between scenarios.

| Scenario | Manual action | Request to run | Expected response behavior | Pass criteria |
| --- | --- | --- | --- | --- |
| Broker timeout | Enable broker delay/timeout injection so broker call exceeds service timeout budget | `curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"` | Request remains protocol-safe and returns deterministic dependency-failure fallback mapping | HTTP response is valid JSON with `streams` present and no malformed payload shape |
| Broker unavailable | Disable broker endpoint or force connection failure/refused state | `curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"` | Same deterministic dependency-failure fallback mapping as broker timeout class | Response is stable/repeatable across repeated requests and payload remains valid |
| Redis timeout | Inject Redis latency above timeout budget | `curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"` | Deterministic degraded/fallback mapping for Redis dependency failure | Response remains protocol-safe; no transport-level crash or malformed JSON |
| Redis unavailable | Stop Redis or force unreachable Redis host/port | `curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"` | Same deterministic degraded/fallback mapping as Redis timeout class | Response contract stays valid and behavior repeats consistently |
| Capacity/shutdown deny | Set capacity full or activate shutdown-window policy | `curl -sS -D - "$ADDON_BASE_URL$STREAM_PATH"` | Policy deny path returns empty `streams` plus actionable notice text | JSON contains `"streams": []` and deny notice is present |

## Execution Checklist

1. Confirm healthy baseline by running the stream request once before injecting faults.
2. Apply exactly one scenario fault from the matrix.
3. Run the stream request and capture headers + body.
4. If diagnostics are available, query `/health/details` and `/operator/metrics` and capture classified source/cause evidence.
5. Record PASS/FAIL using the matrix pass criteria.
6. Clear injected fault and verify baseline is healthy again.
7. Repeat for all five scenarios.

## Expected Outcomes

- Dependency-failure scenarios (broker/Redis timeout or unavailable) map to deterministic fallback/degraded behavior and stay protocol-safe.
- Policy-denied scenario (capacity/shutdown) returns deterministic empty `streams` with actionable notice text.
- No scenario returns malformed payload shape.
- Optional diagnostics views, when accessible, show classified dependency/policy cause information aligned with the scenario triggered.

## Evidence Template (copy per scenario)

- Date/time (UTC):
- Tester:
- Environment:
- Scenario name:
- Fault injection used:
- Request command executed:
- HTTP status:
- Response headers excerpt:
- Response body excerpt:
- PASS/FAIL:
- Correlation ID (if present):
- Optional diagnostics excerpt (`/health/details`, `/operator/metrics`):
- Notes/follow-up:
