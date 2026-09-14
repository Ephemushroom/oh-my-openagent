# Gate review 1: REJECT

Reviewer task `bg_7b835eee`, session `ses_f60d9a2e9ffemvc7bHYUBG4sht`, returned
REJECT. Its sole blocker claimed that completion holds the Executor mutex while
`runtime.notify` synchronously calls execution-delivery, which calls submit and
re-enters that same mutex. It also noted that existing receipts covered root
notifications, not managed-recipient notifications. Other comments were non-blocking.

## Verification of the reported call chain

The production setup passes `notifications.enqueue` as `notify`, not the delivery
function. Enqueue persists the notification and offers its key to the outbox queue.
The scoped worker separately takes that key and calls dispatch. The reviewer
omitted that queue/worker boundary, so the claimed synchronous reentrant call
chain does not match the production assembly.

The coverage gap was valid. It was addressed without changing production locking:

- `plugin/execution-delivery.test.ts` now assembles actual Executor + actual Outbox
  + actual managed delivery. A held parent stays running while its background
  child completes and queues generation 2 on the parent. The test waits for both
  the child completion and outbox dispatch while the parent is still held; then
  releases the parent and observes the queued generation complete. Two tests pass,
  thirteen assertions, no timeout/deadlock.
- `managed-notification-production/receipt.json` contains twelve passing actual
  OpenCode2 2.0.3 production checks, including a managed task spawning a background
  task and receiving its completion in exactly one additional admitted user turn.
  The trace/API/model artifacts capture that turn. Root isolation and cleanup pass.

The preceding `mixed-production-gate` failure was a QA admission race: it called
the host session wait API before the preallocated member session existed. The
driver now waits for the mock model to observe the member's admitted input, then
uses the host wait API. This strengthens the proof and preserves queued acceptance.

`root-tests-gate.log` records 18,709 pass, 40 skips, zero failures; the new managed
notification integration test was subsequently run separately and passed. A
re-review is required; this response does not convert REJECT into APPROVE.
