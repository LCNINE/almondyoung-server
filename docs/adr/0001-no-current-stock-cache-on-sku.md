# 재고 수량은 SKU 행에 캐시하지 않는다

재고는 여러 창고(`warehouse`)에 분산되어 보관되므로 "SKU의 현재 재고"는 단일 스칼라가 아니라 항상 창고 차원의 합/리스트다. 한때 `skus.current_stock` 컬럼이 존재했으나(통합 전 [[project-core-wms-pim-merge]] WMS 흔적) 실제로는 어떤 코드도 그 값을 SET 하지 않아 영원히 0인 dead column이었고, "총 재고"가 필요한 모든 코드는 이미 `stock_summary` 합산으로 구하고 있었다. 따라서 컬럼을 제거하고, **재고의 진실은 `stock_summary` 뿐**이라는 규칙을 박는다 — 표시·성능 목적의 SKU-수준 재고 캐시 컬럼은 다시 만들지 않는다.

## Consequences

- SKU 응답 DTO에 "현재 재고" 필드가 필요하면 응답 어셈블러가 `stock_summary` 를 합산해서 채운다 (필드 자체는 호환을 위해 유지 가능).
- 미래에 성능 이슈로 캐시가 필요해지면, SKU 행 컬럼이 아니라 별도의 read model / materialized view / 캐시 계층으로 풀어야 한다 (warehouse 분산 사실이 반영되는 형태로).
