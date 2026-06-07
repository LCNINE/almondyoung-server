# Core Catalog active 상품 변경은 outbox 이벤트로 Medusa projection 에 반영한다

Core Catalog 는 판매상품 데이터의 source of truth 이고, Medusa 는 판매채널 projection 이다. Medusa 는 우리 Kafka broker 로부터 직접 이벤트를 받지 않으므로 Core Catalog 의 active 상품 변경은 channel-adapter 가 받아서 Medusa Admin API 로 반영한다.

active 판매상품 변경은 `draft 수정 -> publish` 경로로만 발생해야 한다. active version row 를 직접 수정하는 것은 정책상 금지한다. bulk edit 은 기존 운영 흐름상 회색지대가 있으므로 이번 결정의 구현 범위에서 제외하지만, 장기적으로는 active 직접 수정 금지 원칙에 맞춰 별도 재설계해야 한다.

## 결정

- Core Catalog 의 Medusa 판매상품 projection 에 직접 영향을 주는 이벤트는 transactional outbox 로 발행한다.
- 우선 적용 범위는 `ProductMasterActiveVersionChanged`, `ProductMasterDeleted`, `CategoryChanged` 로 제한한다.
- `ProductVariantCreated`, `ProductVariantUpdated`, `ProductVariantDeleted`, `ProductInventoryManagementChanged` 등 다른 product stream 이벤트는 이번 범위에 포함하지 않는다. 장기적으로는 product stream 전체 발행 경로를 outbox 로 통일한다.
- `published` 와 `rollback` 의 `ProductMasterActiveVersionChanged` payload 는 full `snapshot` 을 반드시 포함해야 한다. channel-adapter 는 Core API fallback 을 하지 않는다.
- channel-adapter 의 product event 멱등성은 `masterId + versionId` 같은 aggregate 상태가 아니라 Kafka event instance 기준으로 판단한다. 기본 기준은 envelope `messageId` 이고, fallback 이 필요하면 `masterId`, `versionId`, `changeReason`, `changedAt` 을 함께 사용한다.
- Core 에 active version 이 없어지거나 master/version 이 삭제되어도 Medusa product 는 삭제하지 않는다. Medusa product 는 `draft` 로 전환한다.
- `pim_medusa_mappings` 는 unpublished/deleted 이후에도 유지한다. 다시 publish/rollback 될 때 같은 Medusa product 를 update 하기 위함이다.
- `ProductMasterDeleted` 도 channel-adapter 가 소비하며, unpublished 와 같은 효과로 Medusa product 를 `draft` 로 전환한다.
- `CategoryChanged` 는 Medusa category projection 만 갱신한다. 해당 category 에 연결된 active 상품 전체를 재동기화하지 않는다. 상품의 category membership 변경은 active version publish snapshot 으로 반영한다.

## Consequences

- Core DB 커밋과 이벤트 발행 사이의 손실 가능성을 outbox 로 줄인다.
- channel-adapter 는 느린 Medusa API 호출을 Kafka consumer 안에서 직접 수행하지 않고 inbox worker 로 처리한다.
- Medusa product id, handle, 장바구니/주문/리뷰/링크 참조를 보존하기 위해 상품 삭제 대신 draft 전환을 사용한다.
- 같은 version 으로 다시 rollback 하는 정상 이벤트가 멱등성 필터에 의해 잘못 스킵되지 않는다.
- category 이름, slug, visibility 등 category 엔티티 변경은 category projection 으로만 처리되어 대량 상품 resync 를 유발하지 않는다.
- bulk edit 은 이 ADR 에서 정책상 예외/부채로 남긴다. 별도 작업에서 active 직접 수정 금지 원칙에 맞춰 publish 기반 흐름으로 수렴시켜야 한다.
