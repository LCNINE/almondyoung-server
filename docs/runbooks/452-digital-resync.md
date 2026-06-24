# Runbook: #452 디지털 상품 Core→Medusa 재동기화

> 상태: **준비 완료 / 라이브 미실행.** 관련 PR(#459 등) 머지·배포 후 실행.
> 목적: Medusa 에 디지털로 마킹되지 않은 디지털 상품 150개를 Core(SoT) 기준으로 재동기화하여
> `metadata.fulfillmentKind='digital'` / `requiresShipping=false` / `shipping_profile_id=null` / projection 링크 제거 상태로 정합화.

## 왜 이 작업이 따로 필요한가 (동영님 검토 포인트)

- **코드 배포(#459 등)** = "앞으로 재동기화/신규 동기화/이벤트가 와도 디지털이 안 깨지게" 한다. 이미 잘못 들어간 기존 데이터는 자동으로 안 고쳐진다.
- **#452 재동기화** = 이미 Medusa 에 잘못 들어간 150개의 기존 데이터를 SoT 기준으로 실제 보정한다.
- 지금은 #450 임시 보정(projection inventory 148개 `requires_shipping=false`)으로 **주문 장애는 이미 해소**됨. 따라서 #452 는 즉시 장애복구가 아니라 **영구 정합성 복구**.

## SoT / 방법 결정 근거

- **SoT = Core `product_master_versions.fulfillment_kind`.** 라이브 Core 에서 이미 디지털 150개가 `fulfillment_kind='digital'`. 즉 데이터 정정이 아니라 **재동기화**가 영구 해결.
- **Medusa 직접 백필이 아니라 Core→Medusa 재동기화**인 이유: Medusa 만 직접 고치면 이후 Core 재동기화 때 다시 덮어써져 깨진다. SoT 경로로 밀어야 안정.
- **재동기화 경로 = channel-adapter `scripts/backfill-v2.ts`** (Core SoT → `PimSnapshotBuilder` → `PimMedusaSyncService.upsert` = 프로덕션 transformer/`ensureVariantInventoryLinks` 그대로). 이벤트 재발행 경로는 Core 에 전용 트리거가 없어(버전 변경 시 outbox 발행만) 제외.

## 선행 조건 (A-0 검증 결과)

| 항목 | 상태 |
|---|---|
| 라이브 channel-adapter transformer 가 `fulfillmentKind`/`requiresShipping`/`shipping_profile_id=null` 를 싣는가 | ✅ 충족. 배포된 `dist/apps/channel-adapter/main.js` 에 `fulfillmentKind`(8)·`requiresShipping`(9) 포함 확인(ECS Exec) |
| #459(applyProductSellableQuantityProjection 디지털 skip) 라이브 배포 | ❌ **미배포.** 재동기화 후 sellable-quantity 이벤트가 오면 projection 이 재생성되어 재깨짐 → **#459 배포가 재동기화보다 먼저여야 함** |
| Core digital active master | 150개 |
| Medusa 매핑 | 150/150 (미매핑 0) |
| backfill-v2 의 특정 masterId 타겟 | ✅ 구현됨(이 PR). `--master-ids=<csv>` |
| backfill 스냅샷에 `fulfillment_kind` 포함 | ✅ 구현됨(이 PR). 기존 snapshot-builder 는 `fulfillment_kind` 를 SELECT 하지 않아 backfill 재동기화 시 디지털이 physical 로 마킹되던 버그를 함께 수정 |

### 재동기화 도구 변경 (이 PR 에 포함)
`apps/channel-adapter/scripts/lib/pim-snapshot-builder.ts` + `backfill-v2.ts`:
- **`--master-ids=<csv>` 필터**: `queryMasters` 에 `AND pm.id = ANY($ids)` 옵션 → 전체 1만개가 아니라 디지털 150개만 안전하게 타겟.
- **`fulfillment_kind` 스냅샷 반영**: snapshot-builder 가 `pmv.fulfillment_kind` 를 SELECT 하지 않아, backfill 경로 재동기화 시 `snapshot.fulfillmentKind` 가 비어 디지털이 physical 로 마킹되던 버그 수정. (프로덕션 이벤트 경로는 이벤트 payload 에 fulfillmentKind 가 있어 영향 없었음)
- **backfill-v2 생성자 보정**: `PimMedusaSyncService` 가 3번째 인자(`StorefrontRevalidateService`)를 요구하는데 backfill-v2 가 2개만 넘겨 깨져 있던 것 보정(무인자 생성, env 없으면 no-op).

## 대상 산출 / 검증 스크립트 (READ-ONLY)

`scripts/ops/452-digital-resync-prep.ts` — Core digital master + Medusa 매핑 + Medusa 현재 상태 집계.
재동기화 **전/후 동일 실행**으로 검증한다.

실행: `cd deployments/lcnine/services && npx sst shell --stage live -- npx tsx ../../../scripts/ops/452-digital-resync-prep.ts`

### Baseline (재동기화 전, 2026-06-24 측정)
```
Core digital active master : 150
Medusa 매핑                 : 150 / 150 (미매핑 0)
product 집계               : total=150, marked_digital=2, no_fk=148, has_profile=0
projection requires_shipping=true : 0   (#450 임시보정 유지됨)
```

### 기대치 (재동기화 후)
```
marked_digital = 150   (no_fk = 0)
has_profile = 0        (디지털은 프로필 null 유지)
projection requires_shipping=true = 0
+ 디지털 라인아이템 requires_shipping=false (신규 카트 기준)
```

## 실행 순서 (PR 머지·배포 후)

1. **선행**: #459 포함 관련 PR 머지 → 라이브 배포 완료 확인.
2. **baseline 측정**: `_resync-prep.ts` 실행, 위 baseline 기록.
3. **dry-run 1건**: 디지털 1개만 재동기화.
   - 후보: `[캔바/한글] 샵인샵 계약서` (`prod_01KT8JA8MD2J3FVC8VCPSMN0FG`)
   - 검증(해당 1건): Medusa `metadata.fulfillmentKind='digital'`, `shipping_profile_id=null`, projection 링크 제거, (카트 담아) line item `requires_shipping=false`.
4. **1건 성공 시 전체 150 재동기화** (`--master-ids` 150개).
5. **집계 검증**: `_resync-prep.ts` 재실행 → 기대치 충족 확인. "프로필 없음 + requires_shipping=true projection" 0개 재확인.
6. 결과 보고(코드/라이브 검증 분리).

## 롤백 / 안전장치
- backfill-v2 는 upsert(기존 product 갱신). 디지털 상품에 한정(150 masterId 화이트리스트)하여 물리상품 영향 0.
- 단계적(dry-run 1 → 전체) + 전/후 집계 비교로 이상 즉시 감지.
- 실패/이상 시: 해당 product 는 Core SoT 가 정답이므로 재실행으로 수렴(멱등 upsert).

## 관련
- 코드 PR: #459 (#450/#453/#458 안정화)
- 이슈: #450, #452, #458
