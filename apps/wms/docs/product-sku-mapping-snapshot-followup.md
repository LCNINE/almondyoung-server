## Product-SKU 매핑 스냅샷 후속 리스크와 정리 방안

### 배경
- `ProductSkuMappingService`에서 스냅샷 생성(create/add/remove 시)을 제거하고, 정본은 `product_sku_mappings` + `product_sku_mapping_items`로 유지하도록 변경.
- 스냅샷(`product_sku_mapping_snapshots`)은 주문/출고 시점의 불변 보존을 목적으로 하며, “적용 시점(FO 생성 등)”에만 생성하는 것으로 역할을 분리.

### 리스크 요약
- 기존 `FulfillmentOrderTransactionService`는 FO 생성 중 다음 흐름을 가정함:
  - 활성 매핑 ID 조회 → 해당 매핑의 스냅샷을 조회(`getMappingSnapshot`) → 스냅샷 ID를 `fulfillment_order_items.mappingSnapshotId`로 저장
- 지금은 매핑 변경(create/add/remove) 시 스냅샷이 생성되지 않으므로, FO 생성 시 스냅샷이 없을 수 있음.
- 결과: FO 생성 과정에서 스냅샷 미존재로 인한 오류/불일치 가능성.

### 목표 상태(권장 아키텍처)
- 정본(현재 활성 매핑): `product_sku_mappings` + `product_sku_mapping_items`
- 스냅샷: 주문/출고 시점에 “1 스냅샷 = 1 레코드”로 생성하고, `snapshotData` JSON에 전체 items를 저장
- FO 생성 시 반드시 동일 트랜잭션에서 스냅샷을 생성하고 그 ID를 참조

### 구현 가이드
- 책임 분리:
  - 매핑 서비스: 정본 생성/수정만 담당 (items 테이블 갱신)
  - 주문/출고 트랜잭션 서비스: “적용 시점”에 스냅샷 생성/참조

- 트랜잭션 규칙:
  - 상위 트랜잭션을 하위 호출로 전파. `inTx(exec, tx)` 패턴 사용
  - 하나의 요청(FO 생성 등) 안에서 매핑 조회 → 스냅샷 생성 → FOI 생성이 모두 같은 `tx`에서 수행되어야 함

- 스냅샷 생성 절차(FO 생성 예시):
  1) 활성 매핑 조회(`product_sku_mappings`): 최신 `version` 1건
  2) 매핑 아이템 조회(`product_sku_mapping_items`): 해당 `mappingId` 전체
  3) 스냅샷 생성(`product_sku_mapping_snapshots`):
     - `productId`, `warehouseId`, `sourceVersion` = 활성 매핑의 `version`
     - `snapshotData = { items: [{ variantId, skuId, qtyPerProduct }] }`
     - 필요 시 로깅 컬럼(`variantId`, `skuId`, `quantity`, `mappingId`)은 최소화/단건 기준으로 사용하는 대신 JSON에 진실 유지
  4) 생성된 `snapshot.id`를 `fulfillment_order_items.mappingSnapshotId`에 저장

### API/호출부 변경 포인트
- `FulfillmentOrderTransactionService.createFulfillmentOrder`:
  - 현재: 활성 매핑 ID → `getMappingSnapshot(mappingId)` 조회 → FOI에 `mappingSnapshotId` 설정
  - 변경: 활성 매핑/아이템 조회 → 동일 `tx`에서 스냅샷 생성 함수 호출(`createSnapshotForMapping(mappingId, tx)`) → 반환된 `snapshot.id` 사용

### 스키마/데이터 정합
- `product_sku_mapping_items`에 `variantId` 추가됨. (정본이 variant 단위 매핑을 표현)
- `(mappingId, variantId)` 고유성 보장을 위해 인덱스/제약 추가 권장
- 기존 데이터 마이그레이션:
  - 과거 스냅샷 기반으로 운영된 데이터가 있다면, 최신 활성 매핑을 기준으로 `items`를 역산/채움
  - 일관성 확인 체크리스트 참고

### 안전 체크리스트
- 트랜잭션 전파
  - [ ] 상위 트랜잭션의 `tx`가 스냅샷 생성/FOI 생성까지 동일하게 전파되는가?
- 정본/스냅샷 일치성
  - [ ] 스냅샷 생성 시점의 `sourceVersion`이 활성 매핑의 `version`과 일치하는가?
  - [ ] `snapshotData.items`와 `product_sku_mapping_items` 내용이 동일한가?
- FO 생성/취소/완료 플로우
  - [ ] FO 생성 시 스냅샷을 누락하지 않고 생성/참조하는가?
  - [ ] FO 취소/완료 시 스냅샷 참조 무결성에 문제 없는가?

### 성능/운영 고려사항
- 캐싱: 동일 `(productId, warehouseId)` 조합 매핑을 요청 단위 캐시해 N+1 완화
- 스냅샷 크기: `snapshotData`는 JSON이므로, 항목 수가 크면 객체 크기/인덱스 최적화 고려
- 감사/감사 추적: 스냅샷은 변경 불가 원칙을 지키고, 필요 시 별도 이벤트 로그와 상호 운용

### 후속 작업 목록(권장)
- [ ] 주문 트랜잭션에서 `createSnapshotForMapping(mappingId, tx)` 도입 및 사용 전환
- [ ] `getMappingSnapshot(snapshotId)` 시그니처/의미 정렬 (스냅샷 단건 조회로 명확화)
- [ ] 컨트롤러/서비스 경로별 `tx` 전파 점검 (요청 단위 트랜잭션 유지)
- [ ] 기존 데이터 마이그레이션 스크립트 작성 및 리허설

### 참고
- WMS 트랜잭션 전달 규칙: 서비스/스토어 간 `tx`를 마지막 파라미터로 전달하고, `inTx`로 경계 단일화.

