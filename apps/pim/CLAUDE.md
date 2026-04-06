# PIM (Product Information Management) — CLAUDE.md

> 루트 `CLAUDE.md`의 공통 규칙(레이어 아키텍처, 코딩 컨벤션 등)은 여기서 반복하지 않는다.
> 이 문서는 **PIM 앱에만 해당하는** 설계·규칙·맥락을 기술한다.

---

## 1. 역할과 경계

### 책임지는 것
- 상품 마스터 / 버전 / 변형(Variant) / 옵션의 생성·수정·삭제
- 카테고리 계층 관리 (self-referencing hierarchy)
- 규칙 기반 가격 엔진 (PricingRule) 및 변형별 가격 캐시
- 판매 채널 관리 및 채널별 상품·변형 리스팅
- 태그(TagGroup/TagValue) 관리 및 상품-태그 연결
- 배너(BannerGroup/Banner) 관리
- 상품 승인 워크플로 (draft → pending → approved/rejected)
- 감사 로그(Audit Log), CSV 가져오기/내보내기, 일괄 작업

### 책임지지 않는 것
- **재고(Stock)** — WMS가 소유. PIM은 재고를 조회/변경하지 않는다.
- **주문/결제** — Medusa / Wallet이 담당.
- **파일 저장** — File Service가 담당. PIM은 `fileId`만 참조한다.
- **검색 인덱싱 실행** — Search 앱이 담당. PIM은 이벤트를 발행할 뿐이다.
- **사용자/인증** — User Service가 담당.

---

## 2. Source of Truth (SoT)

| 데이터 | SoT 테이블 | 비고 |
|--------|-----------|------|
| 상품 정보 (이름, 설명, 브랜드 등) | `product_master_versions` | 버전 단위로 관리 |
| 상품 변형 (SKU) | `product_variants` | variant_code가 unique |
| 옵션 체계 | `product_option_groups`, `product_option_values` | 옵션 조합 → 변형 |
| 가격 규칙 | `pricing_rules` | 레이어·스코프·연산 3축 |
| 변형 가격 캐시 | `product_variant_price_cache` | 버전 활성화 시 사전 계산 |
| 카테고리 계층 | `product_categories` | parentId + level + path |
| 판매 채널 구성 | `sales_channels` | config/credentials JSONB |
| 채널-상품 매핑 | `channel_products`, `channel_variant_listings` | 채널별 override 가능 |
| 태그 | `tag_groups`, `tag_values`, `product_tag_values` | 카테고리별 태그 그룹 연결 |
| 배너 | `banner_groups`, `banners` | 시간 기반 노출 제어 |
| 승인 이력 | `product_approval_history` | 상태 변경 기록 |
| 감사 로그 | `product_audit_log` | action, changes(JSONB), IP 등 |

---

## 3. 핵심 설계 패턴

### 3-1. 상품 버전 관리

```
productMasters (1) ──▶ productMasterVersions (N)
                          │
                          ├── status: draft | inactive | active
                          ├── approvalStatus: draft | pending | approved | rejected
                          └── parentVersionId (버전 트리 분기)
```

- **마스터 당 active 버전은 최대 1개** (unique partial index).
- 새 버전은 기존 active 버전을 `parentVersionId`로 참조하며 draft로 생성.
- 승인(approve) 시 기존 active를 inactive로 전환 후 새 버전을 active로 설정 — 단일 트랜잭션.
- 모든 연관 테이블(`productMasterCategories`, `productMasterOptionGroups`, `productMasterVariants`, `productMasterPricingRules`)에 `versionId`가 포함되어 버전별 독립 관리.

### 3-2. 규칙 기반 가격 엔진

계산 순서: **base_price → membership_price → tiered_price** (layer 순서대로 적용)

| 축 | 값 | 설명 |
|----|------|------|
| Layer | `base_price`, `membership_price`, `tiered_price` | 적용 순서 |
| Scope | `all_variants`, `with_option`, `variants` | 대상 범위 |
| Operation | `offset`, `scale`, `override` | 연산 방식 |

- `scale`의 `operationValue`는 **1000배 정수** (예: 1.5배 → 1500).
- `tiered_price`는 `minQuantity` 기준 단계별 가격.
- `VariantPriceCacheService`가 버전 활성화 전 모든 변형의 가격을 사전 계산하여 `product_variant_price_cache`에 저장.

### 3-3. DataLoader 패턴 (N+1 방지)

- `OptionReadLoader` — 변형별 옵션 조합을 배치 로드
- `TagReadLoader` — 상품별 태그를 배치 로드
- `ProductReadAssembler` — 상품 조회 시 옵션·변형·이미지·태그·가격을 조립

### 3-4. 승인 워크플로

```
draft ──submitForApproval──▶ pending ──approve──▶ approved (= active)
                                      ──reject──▶ rejected
```

- `ProductApprovalService`가 상태 전이 관리.
- 전이마다 `product_approval_history`에 기록 (comment, approvedBy).

### 3-5. 소프트 삭제

`productMasterVersions`, `bannerGroups`, `banners`는 `deletedAt`/`deletedBy` 필드로 소프트 삭제.
조회 시 `isNull(deletedAt)` 필터 필수.

---

## 4. 다른 앱과의 의존/연동

### 이벤트 발행 (Kafka)

| 이벤트 | 토픽 | 소비자 | 발행 시점 |
|--------|------|--------|----------|
| `ProductVariantCreated` | `PRODUCT_STREAM` | WMS (매칭 생성) | 변형 생성 시 |
| `ProductMasterUpdated` | `PRODUCT_STREAM` | Search 등 | 버전 업데이트 시 |
| `ProductSnapshot` | `PRODUCT_STREAM` | — | 현재 상태 스냅샷 |

- `@app/events`의 `StreamPublisher<ProductEvents>` 사용.
- DLQ 활성화 (`enableDLQ: true`).
- 이벤트 발행 실패 시 트랜잭션은 커밋됨 (non-blocking).

### 참조하는 외부 ID

| 필드 | 출처 서비스 |
|------|-----------|
| `fileId`, `pcImageFileId`, `mobileImageFileId` | File Service |
| `supplierId` | 외부/수동 관리 |
| `shippingMethodId` | 배송 서비스 |
| `createdBy`, `updatedBy`, `approvedBy` | User Service |

> PIM은 이 서비스들을 직접 호출(HTTP)하지 않는다. ID만 저장하고, 조합은 클라이언트 또는 BFF에서 수행.

---

## 5. 스키마 구조 요약

### 테이블 목록 (28개)

**상품 코어 (13)**
| 테이블 | 역할 |
|--------|------|
| `product_masters` | 상품 마스터 (컨테이너) |
| `product_master_versions` | 버전별 상품 데이터 |
| `product_master_categories` | 마스터-카테고리 M:N (versionId 포함) |
| `product_master_option_groups` | 마스터-옵션그룹 M:N (versionId 포함) |
| `product_master_variants` | 마스터-변형 M:N (versionId 포함) |
| `product_master_pricing_rules` | 마스터-가격규칙 M:N (versionId 포함) |
| `product_option_groups` | 옵션 그룹 (색상, 사이즈 등) |
| `product_option_values` | 옵션 값 (Red, XL 등) |
| `product_option_group_displays` | 옵션 그룹 다국어 표시 |
| `product_option_value_displays` | 옵션 값 다국어 표시 |
| `product_variants` | 변형 (SKU 단위) |
| `variant_option_values` | 변형-옵션값 M:N |
| `product_images` | 버전별 상품 이미지 |

**가격 (3)**
| 테이블 | 역할 |
|--------|------|
| `pricing_rules` | 가격 규칙 정의 |
| `product_variant_price_cache` | 사전 계산된 변형 가격 |
| `product_master_pricing_rules` | (상품 코어에 포함) |

**채널 (4)**
| 테이블 | 역할 |
|--------|------|
| `channel_categories` | 채널 분류 |
| `sales_channels` | 판매 채널 (config/credentials JSONB) |
| `channel_products` | 채널-상품 매핑 |
| `channel_variant_listings` | 채널별 변형 리스팅 (channelItemId 매핑) |

**카테고리 (1)**
| 테이블 | 역할 |
|--------|------|
| `product_categories` | 계층형 카테고리 (parentId, level, path) |

**태그 (4)**
| 테이블 | 역할 |
|--------|------|
| `tag_groups` | 태그 그룹 |
| `tag_values` | 태그 값 |
| `category_tag_groups` | 카테고리-태그그룹 연결 |
| `product_tag_values` | 상품-태그값 연결 |

**배너 (2)**
| 테이블 | 역할 |
|--------|------|
| `banner_groups` | 배너 그룹 (code unique) |
| `banners` | 배너 (시간 기반 노출) |

**운영 (2)**
| 테이블 | 역할 |
|--------|------|
| `product_approval_history` | 승인 이력 |
| `product_audit_log` | 감사 로그 |

**미구현 (2)**
| 테이블 | 역할 |
|--------|------|
| `promotions` | 프로모션 (미사용) |
| `promotion_products` | 프로모션-상품 (미사용) |

### Enum 정의

```
product_master_version_status: draft, inactive, active
product_master_version_approval_status: draft, pending, approved, rejected
pricing_rule_layer: base_price, membership_price, tiered_price
pricing_rule_scope_type: all_variants, with_option, variants
pricing_rule_operation_type: offset, scale, override
```

---

## 6. 개발 참고

- **포트**: 기본 3020 (`process.env.PORT`)
- **HTTP 엔진**: Fastify (Express 아님)
- **파일 업로드**: `@fastify/multipart`, 10MB 제한
- **Swagger**: `/docs` (UI), `/docs.yaml` (YAML)
- **환경 변수 검증**: Zod (`src/config/env.validation.ts`)
- **필수 환경 변수**: `DATABASE_URL`, `ELASTICSEARCH_NODE`
- **트레이싱**: OpenTelemetry (`src/tracing.ts`)
