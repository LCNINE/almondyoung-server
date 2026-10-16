# Night maintenance jobs

The user approved replacing the failed Mac/Codex-thread reservations with independent AWS jobs. The next one-time windows are 2026-10-17 02:00–02:50 and 03:00–06:00 Asia/Seoul. No daytime business mutations are authorized. The implementation stays in a separate almondyoung-maintenance deployment referencing the existing lcnine-services VPC and ECS cluster, with separate Fargate tasks rather than adding load to membership/UGC containers.

## Required behavior

- EventBridge Scheduler invokes one task per job. Schedules start disabled and are enabled only after a deployed read-only dry run passes. No Codex CLI/thread resume, local machine, personal AWS login, or tunnel is used by runtime jobs.
- ECS task role reads only the existing RDS credential secret, the dedicated maintenance administrator secret, and the job's private S3 artifact prefix. Administrator credentials are populated separately at runtime; never commit credentials or tokens. SDK default task credentials refresh automatically.
- Immutable, checksummed manifests hold the previously approved review IDs and unfinished product field proposals. Durable S3 item state and a database session advisory lock prevent duplicate runs and allow interrupted requests to be reconciled before retry.
- PostgreSQL clients enforce read-only sessions and UTC; all review deletion and product updates use normal administrator APIs. Authentication happens at start and is retried once after 401 with fresh login; a second 401/403 stops the job. No automatic retry of ambiguous writes or 429/5xx.
- Review scope is provider=admin via review_eligibilities, undeleted, rating 2 or 3, matching the 3,662-row CSV (767 rating 2; 2,895 rating 3; 619 products; all active). Larger drift stops execution; up to five cumulatively missing approved rows may be skipped only after DB confirmation of unchanged scope fields and preexisting deleted_at, and are reported separately. Five deletes are verified first; subsequent deletes are serial, at least 200ms apart. Every delete is preceded by a read-only eligibility check and followed by deleted_at verification. Rewards and statistics remain the responsibility of the existing DELETE API.
- Product scope is only approved, unfinished, empty productInfo fields in active masters. Preserve existing nonempty values, prices, options, categories, images, and unrelated scalar fields. Distinct draft/version workflow only. Publish events carry origin=bulk_import so membership retains priority. The current bulk spreadsheet flow does not expose productInfo, so add a narrow optional publish-origin DTO to the existing administrator publish API.
- Products are serial, at least 5 seconds apart, at most 20 per batch with 5-minute pauses; stop new products at 05:50 and finish by 06:00. Reviews stop new deletes at 02:45 and finish by 02:50. Delayed scheduler invocations outside the dated window cannot write.
- Check membership backlog, untagged product backlog, and processing leases before business mutations. Stop rather than increase load during service errors/slow responses. Existing queued events previously deferred to 03:00 are not recreated or discarded.
- Persist operation intent before a potentially ambiguous API request; reconcile active version/deleted_at after interruption. Record redacted per-ID outcomes and a final report in S3/CloudWatch. Scheduler task-launch failures and nonzero task exits have alarms. Completed means verified targets exhausted; partial work is reported as partial.

## Operational approval boundary

The chat description above was approved for implementation. Local tests and deployed dry runs do not delete or publish. Deployment needs a renewed operator AWS session; do not substitute a long-term access key. Enable the next dated schedules only after reviewing dry-run counts, manifests and timing. Do not invent a chat/email notification integration or send messages to third parties.

## Builder-review rulings

- One dated product window is intentionally partial: do not add recurring/follow-up schedules without authorization or promise all remaining products finish overnight.
- Review API transaction/deleted_at verification is separate from statistics delivery. UGC stats are asynchronously published and consumed by search in this checkout. Check affected-product UGC aggregates and stats outbox after canary/batches/final; report downstream search/Medusa propagation unverified unless independently observed.
- Load checks run before each business mutation: zero eligible pending membership events; zero stale processing leases; no eligible unmarked product lifecycle backlog; UGC stats/reward outbox backlog no more than 100 and oldest pending under 60 seconds; stop on any new failure since the run started. These thresholds are operational choices, not user-supplied numbers.
- A dedicated read-only DB session owns the advisory lock. Ping it before writes and fail closed on any connection/state-store error. Persist intent before draft creation and every update/publish; unresolved draft creation requires operator reconciliation.
- Scope on resume is the original allowlist minus verified own deletions, plus a single persisted in-flight operation reconciled against DB state. Extra live eligible IDs always stop the run.
- Business writes stop before the hard deadline. A timed-out API may still commit server-side, so logs retain unresolved operations; process exit is not proof of transaction cancellation.
- CloudWatch alarms and S3 reports do not themselves deliver chat messages. Notification destination is being clarified separately; do not claim this chat receives automatic completion messages.

## User update: overnight CPU tolerance

The user explicitly allows elevated off-hours load while asking to minimize it. CPU alone must not abort: adapt item spacing to 1.5× from70% and2× from90%; retain serial execution and five-minute product batch rests. Actual API failures, membership delay, queue failures, scope drift, lock/state failures and dated windows still stop. Persist load snapshots in reports so a stopped run is diagnosable.
