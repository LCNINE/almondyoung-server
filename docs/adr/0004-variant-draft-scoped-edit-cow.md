# Variant draft-scoped 편집 (copy-on-write) 및 publish 시 matching 인계

판매상품(PIM master/variant) 은 버전 격리를 정션 + entity 공유로 구현한다(CONTEXT.md 참조). 옵션 구조/값 변경에 의한 variant 재생성은 이미 `_regenerateVariantsForVersion` 에서 부모-자식 조합 매칭 기반 CoW 로 처리하고 있다. 그러나 **variant 자체의 필드 편집** (이름, 코드, 이미지, 표시순서, 상태) 은 기존 `PUT /variants/:id` 가 in-place UPDATE 로 처리해, draft 와 active 가 같은 variantId 를 공유하는 상황에선 격리가 깨진다 — draft 의 편집이 즉시 active 에 반영된다. 이 ADR 은 그 격리를 채우는 방향을 못 박는다.

## Decision

- **variant 직접 편집은 version-scoped 엔드포인트로만** — `PUT /masters/:masterId/versions/:versionId/variants/:variantId` (단건/bulk/status). draft 상태에서만 호출 가능. 글로벌 `PUT /variants/:id` 와 그 변종은 제거한다 (admin-web 외 호출자 없음을 확인 완료).
- **CoW 트리거 규칙**: 편집 시 그 variantId 가 draft 외 다른 버전의 정션에도 매핑되어 있으면, `product_variants` 새 row clone + `variantOptionValues` clone + draft 의 `productMasterVariants` 정션만 새 ID 로 repoint. 단독 매핑이면 in-place UPDATE.
- **Pricing rule cascading CoW**: variant CoW 와 같은 트랜잭션 안에서, draft 의 `productMasterPricingRules` 가 가리키는 `pricing_rules` 중 `scopeTargetIds` 에 원래 variantId 를 포함하는 룰들도 clone → 새 룰의 `scopeTargetIds` 에서 ID 교체 → draft 의 정션만 새 룰로 repoint. `scopeType='with_option'` 룰은 영향 없음 (옵션값 기반이므로 X' 도 자동 매치).
- **`variantCode` 의 unique 제약 제거**: 글로벌 `.unique()` 만 제거하고 DB 차원의 다른 unique 는 두지 않는다. partial unique on `variant.status='active'` 도 검토했으나, `variant.status` 는 "판매 가능 여부" 라는 별개 의미이고 "현재 active 버전에 매달림" 과 동치가 아니다. 진짜 의도("active 버전의 variant 끼리만 unique") 는 정션 join 이 필요해 partial index 로 표현 불가. 따라서 `publishVersion` 안에서 publish 직전에 active 버전의 variant 들끼리 코드 충돌을 검증한다 (런타임 제약).
- **Publish 시 matching 인계 (cross-module reconcile)**: `publishVersion` 안에서 새 active 의 variant 들 중 `productMatchings` 가 없는 것을 골라, **이전 active 의 같은 옵션 조합 variant** 의 matching + `productVariantSkuLinks` 를 clone (variantId 만 새 ID). 옵션 조합이 일치하지 않으면 unmatched 유지 — 운영자가 product-matching 화면에서 처리. 이로써 본질적이지 않은 variant 변경(이미지/이름) 은 매칭 자동 인계, 옵션 정체성 변화는 끊김.

## Why this shape

검토한 대안과 채택 이유:

- **(α) PIM 의 variant CoW 가 inventory 의 matching 까지 같은 트랜잭션에서 clone**: 운영자 편의는 최대지만 PIM → inventory 모듈 경계를 직접 위반한다 (CLAUDE.md 의 모듈별 스키마 import 규칙). draft 변경 중에도 inventory 측 매핑이 동기되어, draft 단계의 운영자가 의도하지 않은 시점에 매칭 정책 (`preStockSellable` 등) 이 분기되는 부작용이 있다. 기각.
- **(β) PIM 이 `ProductVariantCloned` 도메인 이벤트 발행 → product-matching consumer 가 비동기 clone**: 모듈 경계 깨끗하지만 새 이벤트 컨트랙트 + consumer + outbox 처리로 PR 범위가 커지고, draft 가 잠깐 unmatched 상태로 살게 된다. β 의 가치는 더 큰 인벤토리 자동화가 필요한 시점에 재평가. 현재 범위 밖.
- **(γ, 채택) Publish 시점 reconcile**: CoW 는 PIM 안에 머문다. draft 는 "출시 전" 이므로 matching 미정 상태가 정상이고, publish = "출시 = inventory 와의 계약 체결" 시점에 인계한다. publish 핸들러가 inventory 테이블을 직접 읽고 쓰는 한 줄의 경계 침범이 있긴 하나, β 의 인프라 비용을 피하면서도 같은 결과를 얻는다. 운영 의미가 명확.
- **(δ) Matching 을 master-scoped 로 재설계**: 도메인적으로 솔깃하지만 큰 변경이고, 이번 PR 범위 밖. 별 이슈로 분리.

`variantCode` 의 unique 제약 처리도 같이 결정한 이유: CoW 가 새 variant row 를 만들면 글로벌 unique 가 즉시 충돌하므로, CoW 결정과 분리할 수 없다. partial unique 가 도메인에 맞고 마이그레이션도 단순.

## Consequences

- `PUT /variants/:id`, `PUT /variants/bulk`, `PUT /variants/:id/status` 및 동명의 서비스 메서드 제거. admin-web 의 dead hooks 도 동반 제거.
- 새 엔드포인트는 draft 가 아닌 버전을 대상으로 호출되면 `BadRequestError`.
- `productVariants.variantCode` 의 unique constraint drop + partial unique index 마이그레이션 필요. publish 검증에 active 끼리의 variantCode 충돌 체크 추가.
- `publishVersion` 이 inventory 의 `productMatchings` + `productVariantSkuLinks` 를 직접 읽고 쓴다. 모듈 경계의 의도된 예외 — `core` 가 PIM+WMS 통합 앱이라는 사실 ([[project-core-wms-pim-merge]]) 위에서 정당화. publishVersion 의 트랜잭션이 두 schema 를 함께 다룬다.
- draft 단계의 inventory 시뮬레이션 (재고 충분한지, 출고 가능한지) 은 지원하지 않는다. draft variant 는 publish 전엔 matching 이 없을 수 있으므로. 미래에 필요해지면 (β) 로 보강한다.
- `_findMatchingVariant` 의 옵션 조합 기반 매칭 헬퍼는 publish 핸들러에서도 재사용한다.
