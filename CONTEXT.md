# Domain Context

도메인 명사와 모듈 경계의 출처를 기록한다. 코드에서 직접 추론하기 어렵거나, 추론으로는 자주 틀리는 사실만 적는다.

## 핵심 명사

### 판매상품 (Product / Master + Variant) — PIM 출신
- 정의: 쇼핑몰에서 고객이 보게 되는 상품 단위. **판매**의 단위.
- 구조: 한 **master** 는 여러 **variant** 를 가질 수 있다. 각 variant 는 option value 조합 하나에 대응. master ↔ variant 는 **강결합**.
- 스키마: `apps/core/src/modules/catalog/schema/catalog.schema.ts` 의 `productVariants` 테이블 외.
- 핵심 속성(variant): `variantCode` (unique), `variantName`, `displayOrder`, `status`, `isDefault`, `imageId`.
- **가격은 판매상품의 본질 속성이 아니다.** master/variant 어느 단위에도 가격 컬럼이 묶여있지 않고, 가격은 별도 pricing 모듈(버전 + 규칙)이 관장한다. UI 에서 master 의 "기본 정보" 와 "가격" 은 다른 카드/페이지로 분리되는 게 도메인적으로 자연스럽다.
- 변화 동인: 상품 등록/판매 시작·종료/이미지 변경.

### 재고상품 (SKU) — WMS 출신
- 정의: 물류창고에서 서로 다른 물리적 상품의 단위. **재고**의 단위.
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skus` 테이블.
- 핵심 속성: `code` (unique), `holderId`(소유자), `stockType`, `safetyStock`, 물리 속성(무게/치수/소재), `moq`.
- 변화 동인: 입고/이동/실측/재고 보정.

### SKU Group — 재고상품의 느슨한 묶음
- 정의: 매우 유사한 SKU들의 묶음 (예: 같은 제품인데 색만 다른 색연필).
- 스키마: `apps/core/src/modules/inventory/schema/inventory.schema.ts` 의 `skuGroups` 테이블, `skus.groupId` (nullable).
- master/variant 의 강결합과 달리 **느슨한 결합**: 묶이지 않은 SKU도 정상이고, 그룹 자체는 판매 단위가 아니라 운영 편의용 묶음.

### 판매상품 ↔ 재고상품 관계
- **두 단위는 별개 정체성이다. 1:1로 동등하지 않으며 직접 FK도 없다.**
- 둘 사이 매핑은 `apps/core/src/modules/product-matching/` 모듈이 전담한다.
- 링크 테이블: `productVariantSkuLinks` (현재 `wmsTables` 스키마 그룹에 묶여있는 것은 [[project-core-wms-pim-merge]] 통합 흔적).
- 한 variant 가 여러 SKU 와 연결될 수 있고 그 반대도 가능.

## 출신 시스템

`apps/core` 는 한때 분리되어 있던 WMS와 PIM이 통합된 앱이다. 자세한 맥락은 메모리 [[project-core-wms-pim-merge]].
