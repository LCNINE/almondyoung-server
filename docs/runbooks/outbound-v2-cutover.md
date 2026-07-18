# Outbound V2 hard-cutover runbook

> **⚠️ 현행 절차 (Task 25 PR A 이후) — 아래 본문보다 이 절이 우선한다.**
>
> V1 출고 코드와 `legacy` 워크플로 모드는 코드에서 제거됐다. `FULFILLMENT_WORKFLOW_MODE` 는
> `maintenance | v2` 뿐이고, 옛 값(`legacy`)이나 미설정은 **모든 환경에서 Core 부팅 실패**다
> (`apps/core/src/config/env.validation.ts`). 본문 중 "mode=legacy 로 배포/확인" 을 지시하는
> 단계는 PR A 이전 코드에서만 성립하던 역사 기록이므로 따르지 말 것.
>
> 은퇴는 세 단계로 간다 (플랜 "outbox 4,767 행" 절의 정정된 순서):
>
> 1. ✅ **PR A 배포** — V1 코드 제거 + outbox topic/idempotencyKey 컴파일 강제.
>    `FULFILLMENT_V2_CUTOVER_AT = 2026-07-16T00:00:00.000Z` 확정. **PR A 가 매니페스트를 `v2` 로 바꿔서
>    배포가 maintenance 를 거치지 않고 v2 로 직행했다** — 이게 2번의 절차 선택을 바꿨다.
> 2. ✅ **운영자 정리** — 배포가 v2 라 maintenance 를 요구하는 **본문 툴킷(audit/cleanup/verify)을 쓸 수
>    없어**, 아래 **"v2-live 경량 cleanup"** 절의 raw SQL 로 실행했다. `topic IS NULL` published 4,902 행
>    + FO 139 행 삭제, 게이트 통과. 이 삭제는 마이그레이션에 넣지 않는다(CLAUDE.md 의 광범위 delete 금지).
> 3. **PR B — 배포 후 `migrate`** — `topic`/`idempotency_key` NOT NULL 강화 + V1 컬럼/테이블/enum 드롭.
>    contract 이므로 PR B **자신의 코드**(TS `pgEnum` 트리밍, `facade.ts:334`)를 먼저 배포하고 migrate 한다
>    (ADR-0005 §5). ← **남은 단계.**
>
> 이 릴리스 시점 실측(2026-07-16): 출고 이력 0 (SHIP 이벤트·dispatch_attempts·invoices·shipments
> 전부 0 행), 따라서 본문의 스냅샷/워터마크/관찰기간 의식 대부분은 보호 대상이 없다. cleanup 의
> "SHIP 이벤트 발견 시 중단" 가드는 그 전제를 **검증하는** 장치이므로 유지한다(v2-live 절차도 이 게이트를
> 그대로 수동 실행한다).

## v2-live 경량 cleanup (2026-07-16 세션 3 실제 실행)

> 본문 아래의 maintenance 툴킷(Enter maintenance → Audit → Cleanup → Verify)의 **대체 경로**다. 배포가
> `v2` 로 직행했을 때만 쓴다. 툴킷은 `FULFILLMENT_WORKFLOW_MODE=maintenance` 를 강제하므로
> (`scripts/fulfillment-v2/audit.ts`, `toolkit.ts` 의 "Cleanup is allowed only while ...maintenance") v2
> 상태에선 실행 자체를 거부한다.

**언제 이 경로를 쓰나 / 언제 못 쓰나.** 배포가 v2 인데 **V2 활동이 아직 0** 일 때만 안전하다. survey 에서
`shipments`/`shipment_lines`/`stock_reservations` 중 하나라도 > 0 이면 **새 V2 주문이 이미 생긴 것**이라
롤백 경계를 넘었고 이 raw-delete 는 정상 V2 데이터를 지울 위험이 있다 — 그 경우는 이 절차를 쓰지 말고
v2→maintenance 로 잠깐 내려 조용히 시킨 뒤 본문 툴킷을 쓰거나, "Rollback and incident boundary" 절의
"V2 row exists → repair in V2" 규칙을 따른다.

**왜 raw-delete 가 안전했나 (세 근거).**

1. **전제 검증(순환논법 회피)**: SHIP 게이트가 0 — 툴킷의 abort 쿼리와 동일한 검사를 수동으로 돌려
   "V1 출고가 실제로 없었다"를 *믿는 게 아니라 확인*했다.
2. **V1/V2 구분의 해소**: `fulfillment_orders` 에는 V1/V2 마커 컬럼이 없다(플랜대로 row 별 workflowVersion
   없음). 하지만 survey 에서 `shipments=shipment_lines=reservations=0` → V2 는 아직 아무것도 안 만들었으므로
   **존재하는 FO 전량이 V1**. 이 사실이 "전량 삭제"를 무모함이 아니라 정당한 선택으로 만든다.
3. **DB 차원 트립와이어**: `shipment_lines.fulfillment_order_item_id` 가 `onDelete: 'restrict'` 다
   (`inventory.schema.ts`). FOI 는 FO 에서 cascade 인데, 그 FOI 가 shipment_line 에 물리면 restrict 가
   `DELETE FROM fulfillment_orders` 를 통째로 abort 시킨다. Task 9 가 FO+lines 를 한 트랜잭션에 만드므로
   커밋된 V2 FO 는 항상 line 을 갖고 → 항상 보호된다. 즉 실수로 V2 주문을 지우는 것이 물리적으로 막힌다.

### 절차

`sst tunnel --stage live` 로 붙어 운영자가 직접 실행한다(로컬 아닌 RDS 엔드포인트, 자격증명은 Secrets
Manager `lcnine-services-live-DbProxySecret-*`).

**0. SHIP 게이트 — 삭제 전 반드시 둘 다 0.**

```sql
SELECT
  (SELECT count(*) FROM stock_events   WHERE transition_type::text = 'SHIP')                AS ship_events,
  (SELECT count(*) FROM stock_journals WHERE upper(coalesce(source_type,'')) = 'SHIPMENT')  AS shipment_journals;
-- 0 이 아니면 STOP: V1 출고가 실제로 일어났다는 뜻 → 삭제는 실이력 파괴. 회계/업무 리뷰로.
```

**1. Survey (읽기 전용) — V2 활동이 0 인지, 삭제 대상 규모 확인.**

```sql
SELECT (SELECT count(*) FROM shipments)          AS shipments,
       (SELECT count(*) FROM shipment_lines)     AS shipment_lines,
       (SELECT count(*) FROM stock_reservations) AS reservations;   -- 셋 다 0 이어야 이 경로 사용 가능

SELECT status, count(*) FROM fulfillment_orders GROUP BY status;    -- 삭제 대상 FO
SELECT status, count(*) FROM outbox_events WHERE topic IS NULL GROUP BY status;  -- topicless(전부 published 여야)

SELECT status, (created_at >= TIMESTAMPTZ '2026-07-16T00:00:00Z') AS after_cutover, count(*)
FROM fulfillment_order_creation_backlogs GROUP BY 1,2;  -- recent-pending 있으면 새 주문일 수 있음 → 멈춤
```

**2. 삭제 (한 트랜잭션, rowcount 확인 후 COMMIT).**

```sql
BEGIN;
DELETE FROM stock_reservations WHERE lower(target_type) = 'fulfillment_order';  -- V2는 shipment_line 타깃 → 전부 V1
DELETE FROM fulfillment_order_creation_backlogs;                                 -- replay 방지 (recent-pending 없음 확인 후)
DELETE FROM fulfillment_orders;                                                  -- FOI cascade 동반; V2 있으면 restrict 로 abort
DELETE FROM outbox_events WHERE status = 'published' AND topic IS NULL;          -- v2 이벤트(topic 有)는 불변
-- rowcount 가 survey 예상과 일치하면 COMMIT, 아니면 ROLLBACK.
COMMIT;
```

`AND topic IS NULL` 은 라이브 v2 안전용이다(v2 published 를 건드리지 않고 topicless 만 제거 → NOT NULL 해제엔
충분). 큐 위생으로 v2 published 까지 지우려면 그 절을 빼도 되지만 필수는 아니다.

**3. PR B 게이트 검증 — 둘 다 통과해야 PR B 가능.**

```sql
SELECT count(*) FROM outbox_events WHERE topic IS NULL;   -- 0 → topic NOT NULL 가능
SELECT DISTINCT status FROM fulfillment_orders;           -- 사장 11값 하나도 없어야 enum 드롭 가능
```

### 실행 결과 (2026-07-16 세션 3)

- SHIP 게이트: `ship_events=0, shipment_journals=0` → 전제 검증 통과.
- V2 활동: `shipments=0, shipment_lines=0, reservations=0` → 존재 FO 전량 V1 확정.
- FO: **139 행 삭제** (137 `unfulfillable` + 2 `canceled`). 후자 2 는 `created_at >= cutover`(오늘) 이지만
  shipments=0 이 V2 아님을 증명 — 배포 전 legacy 가 오늘 만든 V1 이다.
- outbox: **4,902 행 삭제** (topicless, 전부 published — topicless pending/failed 0).
- 게이트: `topic IS NULL` → 0, `fulfillment_orders` 전량 삭제로 사장 status 0. **PR B 선행 조건 충족.**
- (row 수는 집계 사실이라 기록 가능. DB 식별자/스냅샷 ID/자격증명은 절대 커밋하지 않는다 — "Evidence record" 절 참조.)

This runbook removes V1 fulfillment work data while preserving sales orders, master data, and the stock journal/event/ledger.
It is a maintenance-window procedure, not an online migration. Never use it to convert or drain individual V1 rows.

## Safety boundary

The toolkit deletes only the audited allowlist:

- all `fulfillment_order_creation_backlogs`
- only `stock_reservations` where `lower(target_type) = 'fulfillment_order'`
- V1 `shipment_tracking`, `inspection_issues`, `invoices`, `shipment_lines`, and `shipments`
- V1 `fulfillment_order_batches`, `fulfillment_order_items`, `fulfillment_orders`, and `outbound_batches`
- all `pending` or `failed` fulfillment/shipment-family `outbox_events` that the shared dispatcher could replay,
  including alternate legacy aggregate spellings and rows with a stale `published_at`

It does not delete sales orders/lines, SKU/warehouse/location master data, stock journals/events/ledgers, audit logs,
processed order-event tombstones, non-FO reservations, or unrelated outbox rows. The cleanup has no `TRUNCATE` or
`CASCADE`; it uses ordered `DELETE` statements in one serializable transaction.

The following conditions stop cleanup:

- a shipment-linked `SHIPMENT` journal or `SHIP` event exists;
- a non-allowlisted row has a live FK to a cleanup row (for example, a return linked to a V1 shipment);
- an `ORDER_CREATED` tombstone has a missing or invalid domain `payload.createdAt`;
- a V2-only table, V2 shipment status, or V2 shipment/fulfillment topic already contains a row;
- the database identity or audited cleanup-state hash has changed;
- the workflow is not in `maintenance`, the cutover timestamp differs, or the advisory lock is held;
- an affected stock grain is over-reserved or its event-derived balance differs from `stock_ledgers`.

Do not work around a blocker by deleting stock history, return history, audit rows, or another service's data. Stop the
cutover and perform a separate business/accounting review.

## Preconditions and evidence

Assign one operator to run commands and a second operator to review their output. Record all evidence in the release
ticket using immutable or access-controlled storage; do not commit audit artifacts or database credentials.

Before the window:

1. Run `DATABASE_URL=<isolated-postgres> yarn test:fulfillment-v2-cutover:integration`. This required suite fails instead
   of skipping when the database URL is absent and proves rollback, scope preservation, stale SHIP detection, and the
   pre-V2-row boundary against real PostgreSQL.
2. Deploy the V2 event contracts and the channel-adapter shipment/fulfillment-v2 consumers before any Core V2 producer.
   Confirm consumer groups are ready, have no schema errors, and can persist inbox events. Confirm legacy
   `FulfillmentShipped` no longer calls Naver or Coupang.
3. Deploy the Core build that supports `FULFILLMENT_WORKFLOW_MODE=maintenance|v2` while still in `legacy`. Confirm its
   startup log and health detail show the intended mode and watermark.
4. Pick one immutable ISO cutover timestamp. Use exactly the same `FULFILLMENT_V2_CUTOVER_AT` value for audit, cleanup,
   verification, and the V2 release.
5. Schedule a platform database snapshot and establish its retention/restore owner. A logical dump is not a substitute
   unless the platform restore procedure has been rehearsed.
6. Prepare a random secret of at least 32 bytes as `FULFILLMENT_V2_AUDIT_SIGNING_KEY`. Every cleanup with `--execute`
   rejects an unsigned artifact, regardless of `NODE_ENV`. Store the secret outside the repository and release logs.

## Deploy the expand release

This deploy is additive and inert. It ships the V2 schema, the V2 code and the channel-adapter consumers while
`FULFILLMENT_WORKFLOW_MODE` stays `legacy`, so no V2 code path executes. Nothing here is part of the maintenance window;
run it earlier, on an ordinary day, and confirm the environment is healthy before scheduling the window.

### Migrate before deploying, not after

For this release the operator runs `db:migrate` **first** and `sst deploy` **second**. This is the opposite of the
`deploy → migrate` habit, and the inversion is deliberate:

- ADR-0005 §5 scopes `deploy → migrate` to the **contract** phase. Deploying first is what guarantees that the old code
  which still selects a dropped column is already drained when `DROP COLUMN` runs.
- The **expand** phase is protected by a different rule — "additive only" — which guarantees that a new schema does not
  break old code. It says nothing about the reverse direction, and the reverse is what bites here: the expand release
  teaches `outbox_events` writes to carry `topic`/`idempotency_key`, and the outbox is on the V1 path too. New code that
  boots before its columns exist would break legacy outbound even with the mode set to `legacy`.
- Migrating first leaves the old tasks meeting new nullable columns during the rolling deploy, which is exactly the case
  the additive-only rule covers.

Task 25's contract release reverses this back to `deploy → migrate`. Check which phase you are in before you start.

There is no autodeploy (ADR-0005 §4), so `db:migrate` does not follow `sst deploy` on its own. Pairing them is the
operator's responsibility.

```bash
sst shell --stage <stage> -- npm run db:migrate -- --deployment lcnine-services --yes
sst deploy --stage <stage>
```

Verify the expand migration is additive before running it. `git diff --name-only <base>...HEAD -- 'apps/*/drizzle/*.sql'`
lists the new files; each must contain only ADD COLUMN/TABLE/INDEX or NULLABLE FK statements. An index dropped and
recreated inside the same release is additive in net effect; a drop of anything that exists on the base branch is not,
and it does not belong in an expand release.

### Consumer readiness comes from the mode, not from deploy order

Core and channel-adapter live in the same SST app (`lcnine-services`), so `sst deploy` rolls out both at once and cannot
order one before the other. The consumer-first requirement is satisfied anyway: channel-adapter subscribes to the
shipment and fulfillment-v2 streams as soon as it is deployed, while Core in `legacy` mode is not a V2 producer at all.
Producers begin only at the `v2` mode flip, which is a later, separate deploy.

After the deploy, confirm before scheduling the window:

- Core's startup log and `/health` detail report `mode=legacy`.
- Channel-adapter consumer groups are ready on both streams, with no schema errors, and can persist inbox rows.
- Legacy `FulfillmentShipped` no longer calls Naver or Coupang.

### Roles live in a different deployment

The two logistics role definitions are seeded into user-service, which `lcnine-auth` owns — not `lcnine-services`. Seed
them on their own deployment and confirm Core holds only the role-name→scope mapping. Role *assignment* to real users
stays a user-service administrator action and is never automated by this release.

```bash
sst shell --stage <stage> -- npm run db:seed:ref -- --deployment lcnine-auth --yes
```

## Enter maintenance

1. Stop upstream physical-order intake or activate the approved manual exception process. Maintenance keeps SO ingestion
   alive but deliberately does not backfill physical orders received during the window.
2. Set `FULFILLMENT_WORKFLOW_MODE` to `maintenance` in the Core `environment` block of
   `deployments/lcnine/services/infra/services.ts`, then `sst deploy --stage <stage>`. The gate reads the mode once at
   construction, so a rolling deploy — not a runtime toggle — is what applies it. Keeping the value in the manifest
   rather than a secret is intentional: it is not sensitive, and every mode change stays reviewable in Git history.
3. Confirm all instances report maintenance mode and the same `FULFILLMENT_V2_CUTOVER_AT`. A half-rolled deploy that
   leaves one legacy task alive still accepts fulfillment mutations and invalidates the audit taken during the window.
4. Confirm FO backlog enqueue/claim, reservation retry, fulfillment mutation, picking, inspection, invoice, and dispatch
   work are stopped. General order ingestion and non-fulfillment outbox publication may remain active.
5. Wait for in-flight fulfillment DB transactions to finish. Do not wait for or publish legacy fulfillment outbox rows.

Example shell setup (values are examples only):

```bash
export DATABASE_URL='postgresql://.../core'
export FULFILLMENT_WORKFLOW_MODE=maintenance
export FULFILLMENT_V2_CUTOVER_AT='2026-07-14T09:00:00+09:00'
export FULFILLMENT_V2_AUDIT_SIGNING_KEY='...secret from the approved secret store...'
export AUDIT_PATH='/secure/cutover/outbound-v2-audit.json'
```

## Audit and platform snapshot

Run the read-only audit:

```bash
yarn fulfillment:v2:audit --output "$AUDIT_PATH"
```

The command creates a new mode-`0600` file and refuses to overwrite an existing path. It prints the artifact SHA-256,
database identity, exact allowlisted counts, number of affected `(warehouseId, skuId)` grains, warnings, and blockers.
It still writes the evidence file when a data blocker is found, then exits with status 2. Preserve that failed audit for
the investigation and do not continue.

Review the JSON with the second operator:

- `integrity.signature` is present and the displayed hash matches the release ticket;
- `database`, `cutoverAt`, and the cleanup allowlist are correct;
- every count/status distribution and affected reservation quantity is understood;
- `shipEvidence.journals` and `shipEvidence.events` are both zero;
- `blockers` is empty;
- open shipments, issued/used invoices, inspection issues, and active batches are confirmed to be non-production work.

Now create the platform database snapshot. Record its immutable snapshot ID, creation time, database identity, the audit
SHA-256, and both operator approvals together. The audit contains an intentional snapshot-ID placeholder; the real ID is
passed to cleanup and printed in its evidence output, so the original signed audit file remains immutable.

```bash
export SNAPSHOT_ID='platform-snapshot-immutable-id'
```

## Dry-run and cleanup

The cleanup command is a dry-run unless `--execute` is present. Dry-run verifies the artifact hash/HMAC, exact toolkit
allowlist, database identity, live cleanup-state hash, snapshot ID, workflow mode, cutover timestamp, SHIP absence,
row-level FK closure, and advisory lock. Protected tables are fingerprinted immediately before and after the simulated
deletes. It executes the ordered cleanup and all post-delete reconciliation behind a savepoint, then rolls the savepoint
back so no rows change:

```bash
yarn fulfillment:v2:cleanup --audit "$AUDIT_PATH" --snapshot-id "$SNAPSHOT_ID"
```

If the live state no longer matches `auditStateHash`, make a new audit, review it, and create/link fresh snapshot evidence.
Do not edit and re-hash the old artifact.

After both operators approve the dry-run, execute exactly once:

```bash
yarn fulfillment:v2:cleanup --audit "$AUDIT_PATH" --snapshot-id "$SNAPSHOT_ID" --execute
```

The command takes `pg_try_advisory_xact_lock(hashtext('fulfillment-v2-hard-cutover/v1'))`, repeats the preflight inside a
serializable transaction, applies ordered deletes, fingerprints all protected tables before/after, and runs affected-stock
reconciliation before commit. Any error rolls back every delete. Save the JSON result with the snapshot and audit evidence.

## Verify and enable V2

Run verification while maintenance is still active:

```bash
yarn fulfillment:v2:verify --audit "$AUDIT_PATH"
```

All checks must be true:

- allowlisted V1 counts and confirmed FO reservations are zero;
- replayable legacy fulfillment/shipment outbox rows are zero;
- old `ORDER_CREATED` tombstones have valid domain time and no backlog/FO that can replay;
- affected reservation totals do not exceed `ON_HAND` ledger totals;
- affected stock-event derivation equals the stock ledger at every location/state grain;
- every V2-only table/status/topic is still empty before activation;
- no journal or SHIP event exists for any shipment ID preserved in the signed audit, even though shipment rows are gone.

Run verify a second time; it is read-only and idempotent. Attach both reports to the release ticket.

### Provider issue/void rehearsal gate

Do not enable shipment invoice issuance merely because provider credentials are present. The provider must publish and
the integration owner must verify all of the following contract evidence first:

- a stable issue idempotency key is accepted and a repeated request returns the same label, or the provider offers a
  query by that key before any repeat;
- a known service ID can be queried and void outcome is distinguishable from timeout/unknown outcome;
- provider 4xx rejection, 408/429/5xx, transport timeout and malformed success responses are classified using the
  production adapter;
- issue succeeds in the sandbox, the Core finalization is deliberately interrupted, and recovery converges to one
  `invoice_operations` row and one active shipment invoice without a second label;
- void succeeds in the sandbox, Core finalization is deliberately interrupted, and recovery converges without exposing
  the waiting cancel/consolidation target early;
- the release ticket records the provider contract version, sandbox operation IDs, Core operation IDs, request hashes,
  attempt counts, final states and two-person review. Do not attach API keys, recipient PII or complete provider payloads.

The current Goodsflow compatibility adapter can query and void an existing known service ID, but it has no verified
idempotent issue or issue-key lookup contract. The Hanjin adapter remains disabled even when environment credentials are
present because its official endpoint, authentication, idempotency and status contracts have not been verified. Both
providers therefore fail closed for new V2 issuance until the above evidence exists. This is a release blocker, not a
reason to mark a provider capability as supported in code.

Then enable V2 by setting both values in the Core `environment` block of
`deployments/lcnine/services/infra/services.ts` and deploying:

```text
FULFILLMENT_WORKFLOW_MODE: 'v2',
FULFILLMENT_V2_CUTOVER_AT: '<the exact audited timestamp>',
```

Set them together in one commit and one deploy. `v2` without a cutover timestamp fails env validation at startup, and a
timestamp that differs from the audited one silently changes which orders enter V2 — the gate compares domain event time
against this exact value.

Confirm all instances report `v2`, channel-adapter consumers remain ready, and the first post-watermark owned physical
order creates one FO plus its initial Draft shipment. Confirm a pre-watermark Kafka redelivery creates neither backlog nor
FO, while ownership self-healing may still run. Resume upstream intake only after these checks pass.

## Rollback and incident boundary

Before the first V2 row exists, stop the rollout, keep intake stopped, restore the recorded platform snapshot, and deploy
the prior release/mode according to the platform restore procedure. Verify the restored database identity and counts
against the signed audit evidence before resuming traffic.

After any V2 FO, shipment, reservation, invoice operation, work item, dispatch attempt, or V2 outbox row exists, do not
restore the V1 snapshot and do not switch mutation traffic back to V1. The rule is:

> V2 row exists -> stop intake and repair in V2.

Keep V2 code deployed, return all Core instances to a non-mutating maintenance state, preserve provider/inbox/outbox
evidence, and follow the V2 recovery/recall procedure for the affected operation. Snapshot restoration after this point
would discard legitimate V2 stock and channel progress.

## Evidence record

Copy this section into the release ticket and fill it there. Do not commit a filled copy: the values below identify a
live database and its snapshot, and the plan forbids environment audit artifacts in the repository. Keep the file paths,
never the file contents.

An empty cell is a blocker, not a formality — each row is the evidence for a release gate that cannot otherwise be
checked. "Ran it and it looked fine" is not an entry.

### Expand deploy

| Field | Value |
|---|---|
| Stage / deployment | |
| Release commit SHA | |
| Migration files applied (Core) | |
| Migration files applied (channel-adapter) | |
| `db:migrate` ran before `sst deploy` (yes/no) | |
| Core reports `mode=legacy` on all instances | |
| Channel-adapter consumer groups ready on both streams | |
| Legacy `FulfillmentShipped` proven not to call Naver/Coupang | |
| user-service roles seeded (`lcnine-auth`) | |

### Maintenance window

| Field | Value |
|---|---|
| Window start / end (with timezone) | |
| Operator running commands | |
| Operator reviewing output | |
| Intake stop method (halt or manual exception list) | |
| All Core instances report `maintenance` | |
| FO backlog / retry / mutation stop confirmed | |

### Audit, snapshot, cleanup, verify

| Field | Value |
|---|---|
| `FULFILLMENT_V2_CUTOVER_AT` (immutable, ISO) | |
| Audit artifact path (outside repo) | |
| Audit SHA-256 | |
| Signature present (yes/no) | |
| `shipEvidence.journals` / `shipEvidence.events` (both must be 0) | |
| Blockers (must be empty) | |
| Platform snapshot ID | |
| Snapshot creation time / retention owner | |
| Dry-run result path + outcome | |
| Both operators approved dry-run | |
| Cleanup result path + outcome | |
| Protected-table hashes match before/after | |
| Verify report #1 path | |
| Verify report #2 path (idempotency re-run) | |

### Provider issue/void rehearsal

Every row must be satisfied by the production adapter against the provider sandbox. See the gate below for why this is
currently a release blocker rather than a checklist item.

| Field | Value |
|---|---|
| Provider / contract version | |
| Issue idempotency key accepted, or lookup-by-key available | |
| Void outcome distinguishable from timeout/unknown | |
| 4xx / 408 / 429 / 5xx / timeout / malformed-success classification verified | |
| Issue interrupted → recovery converged to one label | |
| Void interrupted → recovery converged without early target exposure | |
| Sandbox operation IDs / Core operation IDs | |
| Two-person review | |

### V2 activation

| Field | Value |
|---|---|
| All instances report `v2` + the audited timestamp | |
| First post-watermark order: FO + initial Draft created | |
| Pre-watermark redelivery created neither backlog nor FO | |
| SO identities / Draft lines / partial reservation verified | |
| Outbox topic + channel consumer observability verified | |
| Intake resumed at | |
| Observation window agreed (duration, owner) | |

## Exit checklist

- Release ticket contains audit file hash/HMAC status, snapshot ID, dry-run result, cleanup result, and two verify reports.
- No audit artifact, signing key, database URL, or production row dump is staged in Git.
- All Core instances have one mode and one cutover timestamp; no stale maintenance/legacy instance remains.
- Channel-adapter V2 consumers and inbox workers are healthy before Core producers emit events.
- Upstream intake resumes only after the first-order and pre-watermark-redelivery checks pass.
- The snapshot remains retained until the V2 observation-period/contract-migration gate is approved.
