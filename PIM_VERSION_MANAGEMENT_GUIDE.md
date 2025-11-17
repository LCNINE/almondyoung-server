# PIM 상품 버전 관리 시스템 완전 가이드

**작성일**: 2025-11-17  
**버전**: 1.0  
**대상**: 개발자, 시스템 아키텍트

---

## 목차

1. [개요](#1-개요)
2. [핵심 개념](#2-핵심-개념)
3. [데이터 모델](#3-데이터-모델)
4. [버전 관리 메커니즘](#4-버전-관리-메커니즘)
5. [옵션과 품목 생성](#5-옵션과-품목-생성)
6. [가격 정책 시스템](#6-가격-정책-시스템)
7. [API 워크플로우](#7-api-워크플로우)
8. [주요 서비스 로직](#8-주요-서비스-로직)
9. [제약사항 및 주의사항](#9-제약사항-및-주의사항)
10. [참고 자료](#10-참고-자료)

---

## 1. 개요

### 1.1 PIM 시스템이란?

PIM(Product Information Management)은 판매 상품의 모든 정보를 중앙에서 관리하는 시스템입니다. 
이 시스템은 상품의 기본 정보, 옵션, 가격, 카테고리, 채널별 정보 등을 통합 관리하며, 
다양한 판매 채널(자사몰, 쿠팡, 스마트스토어 등)과 WMS(창고 관리 시스템)에 데이터를 제공합니다.

### 1.2 버전 관리의 필요성

상품 정보는 지속적으로 변경됩니다. 가격 조정, 옵션 추가/제거, 설명 수정 등이 빈번하게 발생하며, 
이러한 변경사항을 안전하게 관리하고 필요시 이전 상태로 되돌릴 수 있어야 합니다.

**버전 관리가 해결하는 문제:**
- **안전한 수정**: draft 상태에서 자유롭게 수정 후 준비되면 publish
- **되돌리기**: 문제가 발생하면 이전 버전으로 즉시 복원
- **변경 이력**: 누가 언제 무엇을 변경했는지 추적
- **동시 작업**: 여러 담당자가 독립적인 draft 버전에서 작업 가능
- **A/B 테스트**: 다른 버전의 상품 정보로 실험 가능

**상품 생성 방식 (Create-Then-Update):**

이 시스템은 **단순화된 생성 방식**을 사용합니다:
1. **빈 draft 생성**: POST /masters {} - 모든 필드 선택사항
2. **세부사항 입력**: PUT /masters/:id - update API로 정보 채우기
3. **옵션 추가**: PUT /masters/:id { optionDiff } - 옵션 및 variants 구성
4. **가격 설정**: PUT /products/:masterId/pricing - 가격 정책 적용
5. **활성화**: PATCH .../publish - 준비되면 active로 전환

이 방식의 장점:
- ✅ 생성 API 복잡도 대폭 감소
- ✅ 비동기 처리 제거로 즉시 확인 가능
- ✅ 일관된 update API 재사용
- ✅ 프론트엔드에서 단계별 입력 가능

### 1.3 시스템 구조 개요

```
┌─────────────────────────────────────────────────────────────┐
│                         PIM 시스템                           │
│                                                              │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐        │
│  │  Product   │───▶│  Options   │───▶│  Variants  │        │
│  │  Masters   │    │  (옵션)    │    │  (품목)    │        │
│  │ (판매상품)  │    └────────────┘    └────────────┘        │
│  └────────────┘                                              │
│       │                                                      │
│       │                                                      │
│       ▼                                                      │
│  ┌────────────┐                                              │
│  │  Pricing   │                                              │
│  │   Rules    │                                              │
│  │ (가격정책)  │                                              │
│  └────────────┘                                              │
└─────────────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
┌──────────────┐          ┌──────────────┐
│   외부 채널   │          │     WMS      │
│ (쿠팡, 자사몰) │          │ (창고관리)   │
└──────────────┘          └──────────────┘
```

---

## 2. 핵심 개념

### 2.1 Product Master (판매 상품)

Product Master는 판매 상품의 기본 단위입니다. 하나의 판매 상품은 여러 버전을 가질 수 있습니다.

**중요한 ID 구분:**
- **`masterId`**: 논리적 그룹 ID (모든 버전이 공유하는 식별자)
- **`id` (versionId)**: 물리적 버전 ID (각 버전마다 고유한 식별자)

예시:
```
판매상품 "무선 이어폰"
  - masterId: "A123" (변하지 않음)
  - version 1: id="V1", versionStatus="inactive"
  - version 2: id="V2", versionStatus="active"   ← 현재 활성
  - version 3: id="V3", versionStatus="draft"     ← 작업 중
```

### 2.2 버전 상태 (versionStatus)

각 버전은 다음 3가지 상태 중 하나를 가집니다:

| 상태 | 설명 | 수정 가능 | 외부 노출 |
|------|------|-----------|-----------|
| `draft` | 작업 중인 초안 | ✅ 가능 | ❌ 비공개 |
| `active` | 현재 활성화된 버전 | ❌ 불가 | ✅ 공개 |
| `inactive` | 비활성화된 이전 버전 | ❌ 불가 | ❌ 비공개 |

**중요 제약사항:**
- masterId당 **오직 하나의 active 버전**만 존재 가능
- active/inactive 버전은 수정 불가 (새 draft 생성 필요)
- draft 버전만 수정 가능

### 2.3 버전 트리 구조

버전은 부모-자식 관계로 연결되어 트리 구조를 형성합니다.

```
masterId: "A123"
│
├── V1 (version=1, status=inactive) [root]
│   ├── V2 (version=2, status=active)
│   │   └── V4 (version=4, status=draft)
│   └── V3 (version=3, status=inactive)
│       └── V5 (version=5, status=draft)
```

- **`parentVersionId`**: 부모 버전을 가리킴
- **최초 버전**: parentVersionId는 null
- **분기**: 하나의 부모에서 여러 자식 생성 가능

### 2.4 Options (옵션)

옵션은 상품의 선택 항목입니다.

**구조:**
- **Option Group**: 옵션의 종류 (예: "색상", "사이즈")
- **Option Value**: 구체적인 값 (예: "빨강", "파랑" / "S", "M", "L")

**표시 정보 (Display):**
- 다국어 지원 (locale)
- 버전별 독립적인 표시명
- 정렬 순서 (sortOrder)

예시:
```
Option Group: "색상"
  - Option Value 1: "red" → Display: "빨강" (ko-KR)
  - Option Value 2: "blue" → Display: "파랑" (ko-KR)

Option Group: "사이즈"
  - Option Value 1: "s" → Display: "S" (ko-KR)
  - Option Value 2: "m" → Display: "M" (ko-KR)
```

### 2.5 Variants (품목)

Variant는 옵션 조합으로 생성되는 실제 판매 단위입니다.

**생성 방식:**
- 옵션이 있는 경우: 모든 옵션 조합을 자동 생성
- 옵션이 없는 경우: 기본 품목 1개 생성 (isDefault=true)

예시:
```
상품: "티셔츠"
옵션:
  - 색상: [빨강, 파랑]
  - 사이즈: [S, M]

생성되는 Variants:
  1. 빨강 × S
  2. 빨강 × M
  3. 파랑 × S
  4. 파랑 × M
```

**중요:** Variant는 절대 삭제되지 않습니다. (WMS 연동 안정성 보장)

### 2.6 Pricing Rules (가격 정책)

가격은 규칙 기반으로 계산됩니다. 0원에서 시작하여 여러 규칙을 순차적으로 적용합니다.

**가격 레이어 (3단계):**
1. **base_price**: 일반 고객 가격
2. **membership_price**: 멤버십 고객 가격
3. **tiered_price**: 수량별 도매 가격

**규칙 적용 순서:**
```
시작: 0원
  ↓
Layer 1 (base_price): 규칙 1 → 규칙 2 → ... → 일반가 확정
  ↓
Layer 2 (membership_price): 규칙 1 → 규칙 2 → ... → 멤버십가 확정
  ↓
Layer 3 (tiered_price): 수량별 규칙 → 도매가 확정
```

**중요**: 가격은 항상 0원에서 시작하여 pricing rules만으로 계산됩니다.

---

## 3. 데이터 모델

### 3.1 핵심 테이블

#### 3.1.1 product_masters (판매 상품 버전)

가장 중요한 테이블로, 판매 상품의 각 버전을 저장합니다.

**주요 컬럼:**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 물리적 버전 ID (PK) |
| `masterId` | uuid | 논리적 그룹 ID (모든 버전 공유) |
| `version` | integer | 버전 번호 (1, 2, 3, ...) |
| `parentVersionId` | uuid | 부모 버전 ID (트리 구조) |
| `versionStatus` | varchar | 버전 상태 (draft/inactive/active) |
| `draftOwnerId` | uuid | draft 소유자 (수정 권한) |
| `name` | varchar | 상품명 |
| `description` | text | 상품 설명 |
| `basePrice` | bigint | 기준 가격 (원 단위) |
| `thumbnail` | text | 썸네일 이미지 URL |
| `tags` | text[] | 마케팅 태그 |
| `attributes` | jsonb | 판매 속성 (색상, 소재 등) |
| `isWholesaleOnly` | boolean | 도매회원 전용 |
| `isMembershipOnly` | boolean | 멤버십회원 전용 |
| `status` | varchar | 상품 상태 (active/inactive/draft) |

**유니크 제약:**
- `(masterId, version)`: 버전 번호는 masterId 내에서 유일
- `(masterId) WHERE versionStatus='active'`: active 버전은 하나만

**인덱스:**
- `idx_masters_master_id`: masterId 조회 최적화
- `idx_masters_version_status`: 상태별 필터링
- `idx_masters_master_id_version`: 버전 조회 최적화

#### 3.1.2 product_option_groups (옵션 그룹)

옵션의 종류를 정의합니다. (예: 색상, 사이즈)

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 옵션 그룹 ID (PK) |
| `createdAt` | timestamp | 생성 시간 |

**특징:**
- 실제 데이터는 Display 테이블에 저장
- 버전 간 재사용 가능

#### 3.1.3 product_option_values (옵션 값)

옵션의 구체적인 값을 정의합니다. (예: 빨강, 파랑)

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 옵션 값 ID (PK) |
| `optionGroupId` | uuid | 소속 옵션 그룹 (FK) |
| `createdAt` | timestamp | 생성 시간 |

**특징:**
- 실제 데이터는 Display 테이블에 저장
- 버전 간 재사용 가능

#### 3.1.4 product_variants (품목)

옵션 조합으로 생성되는 실제 판매 단위입니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 품목 ID (PK) |
| `variantName` | varchar | 품목 이름 (자동 생성 또는 수동) |
| `priceAdjustment` | bigint | 가격 조정 (원 단위) |
| `images` | jsonb | 품목별 이미지 |
| `displayOrder` | integer | 표시 순서 |
| `status` | varchar | 품목 상태 (active/inactive) |
| `isDefault` | boolean | 기본 품목 여부 (옵션 없을 때) |
| `variantCode` | varchar | 품목 코드 (unique) |

**특징:**
- 절대 삭제되지 않음 (WMS 안정성)
- 버전 간 재사용 가능

#### 3.1.5 pricing_rules (가격 규칙)

가격 계산 규칙을 정의합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 규칙 ID (PK) |
| `layer` | varchar | 가격 레이어 (base_price/membership_price/tiered_price) |
| `order` | integer | 레이어 내 적용 순서 |
| `scopeType` | varchar | 적용 범위 (all_variants/with_option/variants) |
| `scopeTargetIds` | uuid[] | 대상 ID 배열 (option_value_ids 또는 variant_ids) |
| `operationType` | varchar | 연산 타입 (offset/scale/override) |
| `operationValue` | bigint | 연산 값 |
| `minQuantity` | integer | 최소 수량 (tiered_price에서만 사용) |

**연산 타입:**
- `offset`: 현재 가격 + operationValue (예: +1000원)
- `scale`: 현재 가격 × (1 + operationValue/1000) (예: ×1.1)
- `override`: operationValue로 덮어쓰기 (예: 15000원으로 고정)

### 3.2 매핑 테이블 (버전별 연결)

버전 관리의 핵심은 매핑 테이블입니다. 옵션/품목/가격규칙은 버전 간 재사용되며, 
매핑 테이블이 특정 버전에 어떤 것들이 속하는지 정의합니다.

#### 3.2.1 product_master_option_groups

Master 버전과 Option Group을 연결합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 매핑 ID (PK) |
| `masterId` | uuid | 논리적 Master ID |
| `optionGroupId` | uuid | 옵션 그룹 ID (FK) |
| `version` | integer | 버전 번호 |
| `createdAt` | timestamp | 생성 시간 |

**유니크 제약:**
- `(masterId, optionGroupId, version)`: 동일 버전에서 중복 방지

**예시:**
```sql
-- Version 1: 색상, 사이즈 옵션 있음
INSERT INTO product_master_option_groups VALUES
  ('M1', 'OG_COLOR', 1),
  ('M1', 'OG_SIZE', 1);

-- Version 2: 색상만 유지 (사이즈 제거)
INSERT INTO product_master_option_groups VALUES
  ('M1', 'OG_COLOR', 2);
```

#### 3.2.2 product_master_variants

Master 버전과 Variant를 연결합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 매핑 ID (PK) |
| `masterId` | uuid | 논리적 Master ID |
| `variantId` | uuid | 품목 ID (FK) |
| `version` | integer | 버전 번호 |
| `createdAt` | timestamp | 생성 시간 |

**유니크 제약:**
- `(masterId, variantId, version)`: 동일 버전에서 중복 방지

#### 3.2.3 product_master_pricing_rules

Master 버전과 Pricing Rule을 연결합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 매핑 ID (PK) |
| `masterId` | uuid | 논리적 Master ID |
| `pricingRuleId` | uuid | 가격 규칙 ID (FK) |
| `version` | integer | 버전 번호 |
| `createdAt` | timestamp | 생성 시간 |

**유니크 제약:**
- `(masterId, pricingRuleId, version)`: 동일 버전에서 중복 방지

#### 3.2.4 variant_option_values

Variant와 Option Value를 연결합니다. (다대다 관계)

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | 매핑 ID (PK) |
| `variantId` | uuid | 품목 ID (FK) |
| `optionValueId` | uuid | 옵션 값 ID (FK) |

**유니크 제약:**
- `(variantId, optionValueId)`: 중복 방지

**예시:**
```sql
-- Variant "빨강 × S"
INSERT INTO variant_option_values VALUES
  ('VAR1', 'OV_RED'),
  ('VAR1', 'OV_S');

-- Variant "파랑 × M"
INSERT INTO variant_option_values VALUES
  ('VAR2', 'OV_BLUE'),
  ('VAR2', 'OV_M');
```

### 3.3 표시 정보 테이블 (다국어/버전별)

옵션의 실제 표시 정보는 별도 테이블에 버전별, 언어별로 저장됩니다.

#### 3.3.1 product_option_group_displays

옵션 그룹의 표시 정보를 저장합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | Display ID (PK) |
| `optionGroupId` | uuid | 옵션 그룹 ID (FK) |
| `masterId` | uuid | Master ID |
| `version` | integer | 버전 번호 |
| `locale` | varchar | 언어 (ko-KR, en-US 등) |
| `displayName` | varchar | 표시명 |
| `description` | text | 설명 |
| `sortOrder` | integer | 정렬 순서 |

**유니크 제약:**
- `(optionGroupId, masterId, version, locale)`: 중복 방지

**예시:**
```sql
-- Version 1: "색상"
INSERT INTO product_option_group_displays VALUES
  ('OG1', 'M1', 1, 'ko-KR', '색상', NULL, 1);

-- Version 2: "컬러"로 변경
INSERT INTO product_option_group_displays VALUES
  ('OG1', 'M1', 2, 'ko-KR', '컬러', NULL, 1);
```

#### 3.3.2 product_option_value_displays

옵션 값의 표시 정보를 저장합니다.

**주요 컬럼:**
| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | Display ID (PK) |
| `optionValueId` | uuid | 옵션 값 ID (FK) |
| `masterId` | uuid | Master ID |
| `version` | integer | 버전 번호 |
| `locale` | varchar | 언어 (ko-KR, en-US 등) |
| `displayName` | varchar | 표시명 |
| `colorCode` | varchar | 색상 코드 (#RRGGBB) |
| `imageUrl` | text | 이미지 URL |
| `sortOrder` | integer | 정렬 순서 |

**유니크 제약:**
- `(optionValueId, masterId, version, locale)`: 중복 방지

### 3.4 ERD (Entity Relationship Diagram)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     PIM 버전 관리 ERD                                    │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│   product_masters        │ ◀─── 판매 상품의 각 버전
│─────────────────────────│
│ id (PK)                  │
│ masterId ◀───────────────┼──┐ (논리적 그룹 ID)
│ version                  │  │
│ parentVersionId ─────────┼──┘ (자기 참조: 부모 버전)
│ versionStatus            │
│ draftOwnerId             │
│ name                     │
│ basePrice                │
│ ...                      │
└──────────────────────────┘
         │
         │ (masterId, version)
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
┌─────────────────────────┐          ┌─────────────────────────┐
│product_master_          │          │product_master_variants  │
│  option_groups          │          │─────────────────────────│
│─────────────────────────│          │ id (PK)                 │
│ id (PK)                 │          │ masterId ───────────────┼─┐
│ masterId ───────────────┼─┐        │ variantId ──────────────┼─┼─┐
│ optionGroupId ──────────┼─┼─┐      │ version                 │ │ │
│ version                 │ │ │      └─────────────────────────┘ │ │
└─────────────────────────┘ │ │                                  │ │
                            │ │                                  │ │
         ┌──────────────────┘ │       ┌──────────────────────────┘ │
         │                    │       │                            │
         ▼                    │       ▼                            │
┌─────────────────────────┐  │  ┌─────────────────────────┐      │
│product_option_groups    │  │  │  product_variants       │      │
│─────────────────────────│  │  │─────────────────────────│      │
│ id (PK) ────────────────┼──┘  │ id (PK) ────────────────┼──────┘
│ createdAt               │     │ variantName             │
└─────────────────────────┘     │ priceAdjustment         │
         │                      │ isDefault               │
         │                      │ status                  │
         ▼                      └─────────────────────────┘
┌─────────────────────────┐              │
│product_option_values    │              │
│─────────────────────────│              ▼
│ id (PK)                 │     ┌─────────────────────────┐
│ optionGroupId (FK)      │     │variant_option_values    │
│ createdAt               │     │─────────────────────────│
└─────────────────────────┘     │ variantId (FK)          │
         │                      │ optionValueId (FK)      │
         │                      └─────────────────────────┘
         ▼
┌──────────────────────────────────┐
│product_option_group_displays     │ ◀─── 옵션 그룹 표시 정보
│──────────────────────────────────│      (버전별, 언어별)
│ id (PK)                          │
│ optionGroupId (FK)               │
│ masterId                         │
│ version                          │
│ locale                           │
│ displayName                      │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│product_option_value_displays     │ ◀─── 옵션 값 표시 정보
│──────────────────────────────────│      (버전별, 언어별)
│ id (PK)                          │
│ optionValueId (FK)               │
│ masterId                         │
│ version                          │
│ locale                           │
│ displayName                      │
│ colorCode                        │
│ imageUrl                         │
└──────────────────────────────────┘


         ┌─────────────────────────────────┐
         │                                 │
         ▼                                 │
┌─────────────────────────┐               │
│product_master_          │               │
│  pricing_rules          │               │
│─────────────────────────│               │
│ id (PK)                 │               │
│ masterId ───────────────┼───────────────┘
│ pricingRuleId ──────────┼─┐
│ version                 │ │
└─────────────────────────┘ │
                            │
         ┌──────────────────┘
         │
         ▼
┌─────────────────────────┐
│   pricing_rules         │ ◀─── 가격 규칙
│─────────────────────────│
│ id (PK)                 │
│ layer                   │ (base_price, membership_price, tiered_price)
│ order                   │
│ scopeType               │
│ scopeTargetIds          │
│ operationType           │
│ operationValue          │
│ minQuantity             │
└─────────────────────────┘
```

---

## 4. 버전 관리 메커니즘

### 4.1 버전 생성 프로세스

#### 4.1.1 최초 상품 생성

새 상품을 생성하면 **빈 draft 상태**로 첫 번째 버전이 생성됩니다.

```typescript
// ProductMastersService._createMasterWithinTransaction()
const masterId = uuidv7();   // 논리적 그룹 ID
const versionId = uuidv7();  // 첫 번째 버전의 물리적 ID

// 빈 draft 상태로 생성 - 모든 세부사항은 update API로 채움
const masterData = {
  id: versionId,            // 물리적 ID
  masterId: masterId,       // 논리적 ID (별도 생성)
  version: 1,               // 첫 번째 버전
  versionStatus: 'draft',   // draft 상태로 시작
  parentVersionId: null,    // 최초 버전은 부모 없음
  draftOwnerId: null,
  
  // 제공된 필드만 사용, 나머지는 기본값
  name: data.name || '새 상품',
  description: data.description ?? null,
  // basePrice 제거 - 가격은 전적으로 pricing rules로 결정
  // ... 기타 필드는 모두 null 또는 기본값
};

await tx.insert(productMasters).values(masterData);

// 항상 기본 variant 1개 생성 (옵션 없음)
const [variant] = await tx.insert(productVariants).values({
  variantName: null,
  isDefault: true,
  status: 'active',
}).returning();

// 매핑 테이블에 연결
await tx.insert(productMasterVariants).values({
  masterId: master.masterId,
  variantId: variant.id,
  version: master.version,
});
```

**중요 포인트:**
- `masterId`와 `id (versionId)`는 **별도로 생성**됩니다
- 첫 버전은 항상 `version=1`, `versionStatus='draft'`로 시작
- **모든 필드가 선택사항**이며, 빈 객체 `{}`로도 생성 가능
- **기본 variant 1개가 즉시 생성**됨 (옵션 없음, isDefault=true)
- 옵션은 update API의 `optionDiff`로 추가 (그 때 variants 재생성)
- **비동기 처리 없음** - 모든 작업이 트랜잭션 내에서 즉시 완료

#### 4.1.2 새 Draft 버전 생성

기존 버전을 기반으로 새로운 draft 버전을 생성합니다.

```typescript
// ProductVersionsService.createDraftVersion()
async createDraftVersion(
  parentVersionId: string,
  userId: string,
  copyMappings: boolean = true,
  tx?: DbTransaction
): Promise<ProductMaster> {
  // 1. 부모 버전 조회
  const parent = await this.getVersionById(parentVersionId, tx);
  
  // 2. 다음 버전 번호 계산
  const maxVersionResult = await tx
    .select({ max: drizzleMax(productMasters.version) })
    .from(productMasters)
    .where(eq(productMasters.masterId, parent.masterId));
  
  const nextVersion = (maxVersionResult[0]?.max || 0) + 1;
  
  // 3. 부모의 모든 필드 복사 (버전 관련 필드 제외)
  const { id, masterId, version, parentVersionId: _, 
          versionStatus, draftOwnerId, 
          createdAt, updatedAt, ...parentData } = parent;
  
  // 4. 새 버전 생성
  const [newVersion] = await tx
    .insert(productMasters)
    .values({
      ...parentData,           // 부모 데이터 복사
      id: uuidv7(),            // 새 물리적 ID
      masterId: parent.masterId, // 동일한 논리적 ID
      version: nextVersion,    // 증가된 버전 번호
      parentVersionId: parentVersionId, // 부모 참조
      versionStatus: 'draft',  // draft 상태
      draftOwnerId: userId,    // 소유자 설정
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  
  // 5. 매핑 복사 (옵션, 품목, 가격정책)
  if (copyMappings) {
    await this._copyMappings(tx, parent.masterId, parent.version, newVersion.version);
  }
  
  return newVersion;
}
```

**매핑 복사 로직:**

```typescript
private async _copyMappings(
  tx: DbTransaction,
  masterId: string,
  fromVersion: number,
  toVersion: number
): Promise<void> {
  // 1. 옵션 그룹 매핑 복사
  const optionGroups = await tx
    .select()
    .from(productMasterOptionGroups)
    .where(and(
      eq(productMasterOptionGroups.masterId, masterId),
      eq(productMasterOptionGroups.version, fromVersion)
    ));
  
  for (const og of optionGroups) {
    await tx.insert(productMasterOptionGroups).values({
      id: uuidv7(),
      masterId: masterId,
      optionGroupId: og.optionGroupId,
      version: toVersion,
      createdAt: new Date(),
    });
    
    // Display 정보도 복사
    await this._copyOptionGroupDisplays(tx, og.optionGroupId, masterId, fromVersion, toVersion);
  }
  
  // 2. 품목 매핑 복사
  const variants = await tx
    .select()
    .from(productMasterVariants)
    .where(and(
      eq(productMasterVariants.masterId, masterId),
      eq(productMasterVariants.version, fromVersion)
    ));
  
  for (const v of variants) {
    await tx.insert(productMasterVariants).values({
      id: uuidv7(),
      masterId: masterId,
      variantId: v.variantId,
      version: toVersion,
      createdAt: new Date(),
    });
  }
  
  // 3. 가격 규칙 매핑 복사
  const pricingRules = await tx
    .select()
    .from(productMasterPricingRules)
    .where(and(
      eq(productMasterPricingRules.masterId, masterId),
      eq(productMasterPricingRules.version, fromVersion)
    ));
  
  for (const pr of pricingRules) {
    await tx.insert(productMasterPricingRules).values({
      id: uuidv7(),
      masterId: masterId,
      pricingRuleId: pr.pricingRuleId,
      version: toVersion,
      createdAt: new Date(),
    });
  }
}
```

### 4.2 버전 상태 전환 (Publish)

Draft 버전을 active 또는 inactive로 전환합니다.

```typescript
// ProductVersionsService.publishVersion()
async publishVersion(
  versionId: string,
  targetStatus: 'active' | 'inactive',
  tx?: DbTransaction
): Promise<void> {
  return this.inTx(async (tx) => {
    // 1. 버전 조회
    const version = await this.getVersionById(versionId, tx);
    
    // 2. draft 상태 확인
    if (version.versionStatus !== 'draft') {
      throw new BadRequestException('Only draft versions can be published');
    }
    
    let previousActiveVersion: ProductMaster | null = null;
    
    // 3. active로 전환하는 경우
    if (targetStatus === 'active') {
      // 기존 active 버전 조회
      try {
        previousActiveVersion = await this.getActiveVersion(version.masterId, tx);
      } catch (e) {
        // active 버전이 없을 수 있음
      }
      
      // 기존 active 버전을 inactive로 변경
      await tx
        .update(productMasters)
        .set({ versionStatus: 'inactive' })
        .where(
          and(
            eq(productMasters.masterId, version.masterId),
            eq(productMasters.versionStatus, 'active')
          )
        );
    }
    
    // 4. draft를 targetStatus로 변경
    await tx
      .update(productMasters)
      .set({ 
        versionStatus: targetStatus, 
        draftOwnerId: null,  // 소유자 제거
        updatedAt: new Date() 
      })
      .where(eq(productMasters.id, versionId));
    
    // 5. WMS 이벤트 발행 (Variant 변경사항)
    if (targetStatus === 'active') {
      await this._publishVariantChangeEvents(version, previousActiveVersion, tx);
    }
  }, tx);
}
```

**상태 전환 규칙:**
- **draft → active**: 기존 active를 inactive로 변경 후 전환
- **draft → inactive**: 그냥 inactive로 변경
- **active/inactive → draft**: 불가능 (새 draft 생성 필요)

### 4.3 버전 트리 조회

모든 버전을 트리 구조로 조회합니다.

```typescript
// ProductVersionsService.getVersionTree()
async getVersionTree(masterId: string, tx?: DbTransaction): Promise<VersionTreeNode[]> {
  return this.inTx(async (tx) => {
    // 1. 모든 버전 조회
    const versions = await tx
      .select()
      .from(productMasters)
      .where(eq(productMasters.masterId, masterId))
      .orderBy(productMasters.version);
    
    if (versions.length === 0) {
      throw new NotFoundException(`No versions found for master ${masterId}`);
    }
    
    // 2. Map으로 변환
    const versionMap = new Map<string, VersionTreeNode>();
    const rootNodes: VersionTreeNode[] = [];
    
    for (const version of versions) {
      const node: VersionTreeNode = {
        id: version.id,
        masterId: version.masterId,
        version: version.version,
        versionStatus: version.versionStatus as VersionStatus,
        name: version.name,
        parentVersionId: version.parentVersionId,
        children: [],
        createdAt: version.createdAt!,
        updatedAt: version.updatedAt!,
        draftOwnerId: version.draftOwnerId,
      };
      versionMap.set(version.id, node);
    }
    
    // 3. 트리 구조 구성
    for (const node of versionMap.values()) {
      if (node.parentVersionId) {
        const parent = versionMap.get(node.parentVersionId);
        if (parent) {
          parent.children.push(node);
        } else {
          // 부모를 찾지 못한 경우 루트로
          rootNodes.push(node);
        }
      } else {
        // parentVersionId가 null이면 루트
        rootNodes.push(node);
      }
    }
    
    return rootNodes;
  }, tx);
}
```

**결과 예시:**

```json
[
  {
    "id": "V1",
    "masterId": "M1",
    "version": 1,
    "versionStatus": "inactive",
    "name": "무선 이어폰",
    "parentVersionId": null,
    "children": [
      {
        "id": "V2",
        "masterId": "M1",
        "version": 2,
        "versionStatus": "active",
        "name": "무선 이어폰",
        "parentVersionId": "V1",
        "children": [
          {
            "id": "V4",
            "masterId": "M1",
            "version": 4,
            "versionStatus": "draft",
            "name": "무선 이어폰 Pro",
            "parentVersionId": "V2",
            "children": []
          }
        ]
      },
      {
        "id": "V3",
        "masterId": "M1",
        "version": 3,
        "versionStatus": "inactive",
        "name": "무선 이어폰",
        "parentVersionId": "V1",
        "children": []
      }
    ]
  }
]
```

### 4.4 버전 비교

두 버전 간의 차이를 비교합니다.

```typescript
// ProductVersionsService.compareVersions()
async compareVersions(
  versionId1: string,
  versionId2: string,
  tx?: DbTransaction
): Promise<VersionDiffDto[]> {
  return this.inTx(async (tx) => {
    const version1 = await this.getVersionById(versionId1, tx);
    const version2 = await this.getVersionById(versionId2, tx);
    
    const diffs: VersionDiffDto[] = [];
    
    // 비교 대상 필드 목록
    const fieldsToCompare = [
      'name', 'description', 'brand', 'thumbnail', 
      'basePrice', 'tags', 'attributes',
      'isWholesaleOnly', 'isMembershipOnly',
      'status', 'productType', 'material',
      // ... 기타 필드들
    ];
    
    for (const field of fieldsToCompare) {
      const val1 = version1[field];
      const val2 = version2[field];
      
      // 값이 다른 경우만 추가
      if (JSON.stringify(val1) !== JSON.stringify(val2)) {
        diffs.push({
          field,
          oldValue: val1,
          newValue: val2,
        });
      }
    }
    
    return diffs;
  }, tx);
}
```

### 4.5 버전 수정 권한

Draft 버전만 수정 가능하며, 소유자 확인이 필요합니다.

```typescript
// ProductVersionsService.canUserModifyVersion()
async canUserModifyVersion(
  versionId: string,
  userId: string,
  tx?: DbTransaction
): Promise<boolean> {
  return this.inTx(async (tx) => {
    const version = await this.getVersionById(versionId, tx);
    
    // 1. draft 상태 확인
    if (version.versionStatus !== 'draft') {
      return false;
    }
    
    // 2. 소유자 확인 (draftOwnerId가 null이면 누구나 수정 가능)
    if (version.draftOwnerId && version.draftOwnerId !== userId) {
      return false;
    }
    
    return true;
  }, tx);
}
```

**컨트롤러에서 사용:**

```typescript
// ProductMastersController.updateMaster()
@Put(':id')
async updateMaster(
  @Param('id') versionId: string,
  @Body() dto: UpdateMasterDto,
  @CurrentUser() user: User,
) {
  // 권한 확인
  const canModify = await this.productVersionsService.canUserModifyVersion(
    versionId,
    user.id
  );
  
  if (!canModify) {
    throw new ForbiddenException(
      'Only draft versions can be modified. Create a new draft version to make changes.'
    );
  }
  
  // 수정 진행
  return this.productMastersService.updateMaster(versionId, dto);
}
```

---

## 5. 옵션과 품목 생성

### 5.1 옵션 구조

옵션은 3단계 구조로 이루어집니다:
1. **Option Group**: 옵션 종류 (ID만 저장)
2. **Option Value**: 옵션 값 (ID만 저장)
3. **Display**: 실제 표시 정보 (버전별, 언어별)

### 5.2 옵션 생성 프로세스

```typescript
// ProductMastersService에서 상품 생성 시
async _createMasterWithinTransaction(
  data: CreateMasterDto,
  tx: DbTransaction
): Promise<ProductMaster> {
  // 1. Master 레코드 생성
  const master = await tx.insert(productMasters).values(masterData).returning();
  
  // 2. 옵션 처리 (있는 경우)
  if (data.optionGroups && data.optionGroups.length > 0) {
    await this._processOptions(master, data.optionGroups, tx);
  }
  
  return master;
}

async _processOptions(
  master: ProductMaster,
  optionGroups: any[],
  tx: DbTransaction
): Promise<void> {
  for (const ogData of optionGroups) {
    // 1. Option Group 생성 (ID만)
    const [optionGroup] = await tx
      .insert(productOptionGroups)
      .values({ id: uuidv7(), createdAt: new Date() })
      .returning();
    
    // 2. Master와 매핑
    await tx.insert(productMasterOptionGroups).values({
      id: uuidv7(),
      masterId: master.masterId,
      optionGroupId: optionGroup.id,
      version: master.version,
      createdAt: new Date(),
    });
    
    // 3. Display 정보 저장 (버전별, 언어별)
    await tx.insert(productOptionGroupDisplays).values({
      id: uuidv7(),
      optionGroupId: optionGroup.id,
      masterId: master.masterId,
      version: master.version,
      locale: 'ko-KR',
      displayName: ogData.displayName,
      description: ogData.description,
      sortOrder: ogData.sortOrder || 0,
      createdAt: new Date(),
    });
    
    // 4. Option Values 생성
    for (const ovData of ogData.values) {
      const [optionValue] = await tx
        .insert(productOptionValues)
        .values({
          id: uuidv7(),
          optionGroupId: optionGroup.id,
          createdAt: new Date(),
        })
        .returning();
      
      // 5. Display 정보 저장
      await tx.insert(productOptionValueDisplays).values({
        id: uuidv7(),
        optionValueId: optionValue.id,
        masterId: master.masterId,
        version: master.version,
        locale: 'ko-KR',
        displayName: ovData.displayName,
        colorCode: ovData.colorCode,
        imageUrl: ovData.imageUrl,
        sortOrder: ovData.sortOrder || 0,
        createdAt: new Date(),
      });
    }
  }
}
```

### 5.3 품목(Variant) 자동 생성

옵션이 정의되면 모든 조합을 자동으로 생성합니다.

```typescript
// ProductMastersService._generateVariants()
async _generateVariants(
  master: ProductMaster,
  optionGroups: any[],
  tx: DbTransaction
): Promise<void> {
  // 1. 옵션이 없으면 기본 품목 1개 생성
  if (!optionGroups || optionGroups.length === 0) {
    const [variant] = await tx
      .insert(productVariants)
      .values({
        variantName: null,
        isDefault: true,
        status: 'active',
      })
      .returning();
    
    // 매핑
    await tx.insert(productMasterVariants).values({
      id: uuidv7(),
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
      createdAt: new Date(),
    });
    
    // WMS 이벤트 발행
    await this.publishVariantCreatedEvent(master, variant, null);
    return;
  }
  
  // 2. 모든 옵션 조합 생성
  const combinations = this.generateOptionCombinations(optionGroups);
  
  for (const combination of combinations) {
    // Variant 생성
    const [variant] = await tx
      .insert(productVariants)
      .values({
        variantName: combination.map((v) => v.displayName).join(' × '),
        isDefault: false,
        status: 'active',
      })
      .returning();
    
    // Master와 매핑
    await tx.insert(productMasterVariants).values({
      id: uuidv7(),
      masterId: master.masterId,
      variantId: variant.id,
      version: master.version,
      createdAt: new Date(),
    });
    
    // Variant와 Option Values 연결
    for (const optionValue of combination) {
      await tx.insert(variantOptionValues).values({
        variantId: variant.id,
        optionValueId: optionValue.id,
      });
    }
    
    // WMS 이벤트 발행
    await this.publishVariantCreatedEvent(
      master,
      variant,
      combination.map((opt) => ({
        name: opt.groupName,
        value: opt.displayName,
      }))
    );
  }
}
```

### 5.4 옵션 조합 알고리즘

```typescript
// ProductMastersService.generateOptionCombinations()
generateOptionCombinations(optionGroups: any[]): any[] {
  if (optionGroups.length === 0) {
    return [];
  }
  
  // 재귀적으로 모든 조합 생성
  const generate = (index: number, current: any[]): any[][] => {
    if (index === optionGroups.length) {
      return [current];
    }
    
    const group = optionGroups[index];
    const results: any[][] = [];
    
    for (const value of group.values) {
      results.push(
        ...generate(index + 1, [
          ...current,
          { ...value, groupName: group.displayName },
        ])
      );
    }
    
    return results;
  };
  
  return generate(0, []);
}
```

**예시:**
```
입력:
  - 색상: [빨강, 파랑]
  - 사이즈: [S, M, L]

출력:
  1. [빨강, S]
  2. [빨강, M]
  3. [빨강, L]
  4. [파랑, S]
  5. [파랑, M]
  6. [파랑, L]
```

### 5.5 옵션 수정 (OptionDiff)

기존 상품의 옵션을 수정할 때는 `OptionDiff` 구조를 사용합니다.

```typescript
export interface OptionDiff {
  add?: AddOptionDto[];             // 새 옵션 추가
  modifyDisplay?: ModifyOptionDisplayDto[]; // 표시명 수정
  addValues?: AddOptionValuesDto[];  // 옵션값 추가
  removeValues?: RemoveOptionValuesDto[]; // 옵션값 제거
  remove?: string[];                 // 옵션 그룹 제거
}
```

**예시:**

```json
{
  "add": [
    {
      "displayName": "재질",
      "values": [
        { "displayName": "면" },
        { "displayName": "폴리에스터" }
      ]
    }
  ],
  "modifyDisplay": [
    {
      "optionGroupId": "OG1",
      "displayName": "컬러",
      "values": [
        {
          "optionValueId": "OV1",
          "displayName": "레드"
        }
      ]
    }
  ],
  "addValues": [
    {
      "optionGroupId": "OG2",
      "values": [
        { "displayName": "XL" }
      ]
    }
  ],
  "removeValues": [
    {
      "optionGroupId": "OG2",
      "optionValueIds": ["OV_XXS"]
    }
  ],
  "remove": ["OG_OLD"]
}
```

---

## 6. 가격 정책 시스템

### 6.1 가격 계산 프로세스

가격은 0원에서 시작하여 3단계 레이어를 거쳐 계산됩니다.

```typescript
// PricingCalculatorService.calculateVariantPrice()
async calculateVariantPrice(
  masterId: string,
  variantId: string,
  quantity?: number,
  customerType: 'regular' | 'membership' = 'regular',
  tx?: DbTransaction
): Promise<PriceCalculationResult> {
  return this.inTx(async (trx) => {
    // 1. 가격 규칙 조회
    const rules = await this.getRulesForMaster(masterId, undefined, trx);
    
    let currentPrice = 0;
    const appliedRules: AppliedRuleInfo[] = [];
    const breakdown = {
      initialPrice: 0,
      afterBasePrice: 0,
      afterMembershipPrice: undefined as number | undefined,
      afterTieredPrice: undefined as number | undefined,
    };
    
    // 2. Layer 1: base_price (항상 적용)
    for (const rule of rules.basePriceRules) {
      if (await this.matchesScope(variantId, rule, trx)) {
        const priceBeforeRule = currentPrice;
        currentPrice = this.applyRule(currentPrice, rule);
        appliedRules.push({
          ruleId: rule.id,
          layer: 'base_price',
          order: rule.order,
          scopeType: rule.scopeType as ScopeType,
          operationType: rule.operationType as OperationType,
          operationValue: rule.operationValue,
          priceBeforeRule,
          priceAfterRule: currentPrice,
        });
      }
    }
    breakdown.afterBasePrice = currentPrice;
    
    // 3. Layer 2: membership_price (멤버십 고객만)
    if (customerType === 'membership') {
      for (const rule of rules.membershipPriceRules) {
        if (await this.matchesScope(variantId, rule, trx)) {
          const priceBeforeRule = currentPrice;
          currentPrice = this.applyRule(currentPrice, rule);
          appliedRules.push({
            ruleId: rule.id,
            layer: 'membership_price',
            order: rule.order,
            scopeType: rule.scopeType as ScopeType,
            operationType: rule.operationType as OperationType,
            operationValue: rule.operationValue,
            priceBeforeRule,
            priceAfterRule: currentPrice,
          });
        }
      }
      breakdown.afterMembershipPrice = currentPrice;
    }
    
    // 4. Layer 3: tiered_price (수량별 도매가)
    if (quantity) {
      const applicableTieredRules = rules.tieredPriceRules.filter(
        (rule) => rule.minQuantity && quantity >= rule.minQuantity
      );
      
      for (const rule of applicableTieredRules) {
        if (await this.matchesScope(variantId, rule, trx)) {
          const priceBeforeRule = currentPrice;
          currentPrice = this.applyRule(currentPrice, rule);
          appliedRules.push({
            ruleId: rule.id,
            layer: 'tiered_price',
            order: rule.order,
            scopeType: rule.scopeType as ScopeType,
            operationType: rule.operationType as OperationType,
            operationValue: rule.operationValue,
            priceBeforeRule,
            priceAfterRule: currentPrice,
          });
        }
      }
      breakdown.afterTieredPrice = currentPrice;
    }
    
    const finalPrice = currentPrice;
    
    return {
      variantId,
      price: finalPrice,
      totalPrice: quantity ? finalPrice * quantity : undefined,
      appliedRules,
      priceBreakdown: breakdown,
    };
  }, tx);
}
```

### 6.2 가격 규칙 적용

#### 6.2.1 Scope 매칭

규칙이 해당 Variant에 적용되는지 확인합니다.

```typescript
// PricingCalculatorService.matchesScope()
async matchesScope(
  variantId: string,
  rule: PricingRule,
  tx: DbTransaction
): Promise<boolean> {
  switch (rule.scopeType) {
    case 'all_variants':
      // 모든 Variant에 적용
      return true;
    
    case 'with_option':
      // 특정 Option Value를 가진 Variant에 적용
      if (!rule.scopeTargetIds || rule.scopeTargetIds.length === 0) {
        return false;
      }
      
      const variantOptions = await tx
        .select({ optionValueId: variantOptionValues.optionValueId })
        .from(variantOptionValues)
        .where(eq(variantOptionValues.variantId, variantId));
      
      const variantOptionIds = variantOptions.map((vo) => vo.optionValueId);
      
      // scopeTargetIds의 모든 옵션을 가지고 있어야 함
      return rule.scopeTargetIds.every((targetId) =>
        variantOptionIds.includes(targetId)
      );
    
    case 'variants':
      // 특정 Variant에만 적용
      if (!rule.scopeTargetIds || rule.scopeTargetIds.length === 0) {
        return false;
      }
      return rule.scopeTargetIds.includes(variantId);
    
    default:
      return false;
  }
}
```

#### 6.2.2 연산 적용

```typescript
// PricingCalculatorService.applyRule()
applyRule(currentPrice: number, rule: PricingRule): number {
  switch (rule.operationType) {
    case 'offset':
      // 더하기/빼기 (예: +1000원)
      return currentPrice + rule.operationValue;
    
    case 'scale':
      // 비율 적용 (예: +10% = 1000 * 1.1)
      // operationValue는 1000배수 (10% = 100)
      return Math.ceil((currentPrice * (1000 + rule.operationValue)) / 1000);
    
    case 'override':
      // 고정 가격 (예: 15000원으로 고정)
      return rule.operationValue;
    
    default:
      return currentPrice;
  }
}
```

### 6.3 가격 정책 설정 예시

#### 예시 1: 기본 가격 + 멤버십 할인

```json
{
  "basePriceRules": [
    {
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    }
  ],
  "membershipPriceRules": [
    {
      "layer": "membership_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100
    }
  ],
  "tieredPriceRules": []
}
```

**결과:**
- 일반 고객: 10,000원
- 멤버십 고객: 9,000원 (10% 할인)

#### 예시 2: 옵션별 차등 가격

```json
{
  "basePriceRules": [
    {
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 20000
    },
    {
      "layer": "base_price",
      "order": 2,
      "scopeType": "with_option",
      "scopeTargetIds": ["OV_XL"],
      "operationType": "offset",
      "operationValue": 5000
    }
  ]
}
```

**결과:**
- S, M, L: 20,000원
- XL: 25,000원 (+5,000원)

#### 예시 3: 수량별 도매가

```json
{
  "basePriceRules": [
    {
      "layer": "base_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "override",
      "operationValue": 10000
    }
  ],
  "membershipPriceRules": [],
  "tieredPriceRules": [
    {
      "layer": "tiered_price",
      "order": 1,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -50,
      "minQuantity": 10
    },
    {
      "layer": "tiered_price",
      "order": 2,
      "scopeType": "all_variants",
      "operationType": "scale",
      "operationValue": -100,
      "minQuantity": 50
    }
  ]
}
```

**결과:**
- 1~9개: 10,000원
- 10~49개: 9,500원 (5% 할인)
- 50개 이상: 9,000원 (10% 할인)

---

## 7. API 워크플로우

### 7.1 상품 생성 플로우 (간소화)

**Create-Then-Update 패턴**: 빈 draft 상품을 먼저 생성하고, 세부사항은 update API로 채웁니다.

```
Step 1: 빈 draft 생성
사용자 → POST /masters
        {
          // 모든 필드 선택사항, 빈 객체도 가능
        }
        
        ↓
        
ProductMastersController
  → ProductMastersService.createMaster()
     ↓
     1. masterId = uuidv7()  (논리적 ID)
     2. versionId = uuidv7() (물리적 ID)
     3. version = 1, status = 'draft'
     4. name = "새 상품" (기본값)
     5. 기본 variant 1개 생성 (옵션 없음)
        - variantName = null, isDefault = true
        - WMS 이벤트 발행
     
        ↓
        
응답: {
  "id": "versionId_v1",
  "masterId": "masterId_A",
  "version": 1,
  "versionStatus": "draft",
  "name": "새 상품",
  // 대부분 필드 null
}

Step 2: 기본 정보 입력
사용자 → PUT /masters/:versionId
        {
          "name": "무선 이어폰",
          "description": "상품 설명",
          "brand": "브랜드명"
        }

Step 3: 옵션 추가
사용자 → PUT /masters/:versionId
        {
          "optionDiff": {
            "add": [
              {
                "displayName": "색상",
                "values": [
                  { "displayName": "블랙" },
                  { "displayName": "화이트" }
                ]
              }
            ]
          }
        }
        ↓
     기존 기본 variant 삭제 → 옵션 조합으로 variants 자동 생성

Step 4: 가격 정책 설정
사용자 → PUT /products/:masterId/pricing
        {
          "basePriceRules": [
            {
              "layer": "base_price",
              "order": 1,
              "scopeType": "all_variants",
              "operationType": "override",
              "operationValue": 50000
            }
          ]
        }

Step 5: Publish
사용자 → PATCH /masters/:masterId/versions/:versionId/publish
        { "targetStatus": "active" }
```

**주요 변경사항**:
- **basePrice 필드 제거**: 가격은 전적으로 pricing rules로 결정
- **옵션은 update API로**: 생성 시 optionGroups 불가, optionDiff 사용
- **비동기 처리 제거**: 모든 작업이 즉시 완료
- **빈 객체 생성 가능**: POST /masters {} 가능

### 7.2 버전 Publish 플로우

```
사용자 → PATCH /masters/:masterId/versions/:versionId/publish
        {
          "targetStatus": "active"
        }
        
        ↓
        
ProductVersionsController
  → ProductVersionsService.publishVersion()
     ↓
     트랜잭션 시작
     1. 버전 조회 (draft 확인)
     2. 기존 active 버전 조회
     3. 기존 active → inactive 변경
     4. draft → active 변경
     5. WMS 이벤트 발행 (Variant 변경사항)
     트랜잭션 커밋
     
        ↓
        
응답: {
  "message": "Version published successfully",
  "masterId": "masterId_A",
  "version": 1,
  "newStatus": "active"
}
```

### 7.3 새 Draft 버전 생성 플로우

```
사용자 → POST /masters/:masterId/versions
        {
          "parentVersionId": "versionId_v1",
          "copyMappings": true
        }
        
        ↓
        
ProductVersionsController
  → ProductVersionsService.createDraftVersion()
     ↓
     트랜잭션 시작
     1. 부모 버전 조회
     2. 다음 버전 번호 계산 (version = 2)
     3. 부모 데이터 복사
     4. 새 버전 생성 (status = 'draft')
     5. 매핑 복사
        - 옵션 매핑 복사
        - Variant 매핑 복사
        - 가격 규칙 매핑 복사
        - Display 정보 복사
     트랜잭션 커밋
     
        ↓
        
응답: {
  "id": "versionId_v2",
  "masterId": "masterId_A",
  "version": 2,
  "versionStatus": "draft",
  "parentVersionId": "versionId_v1",
  "name": "무선 이어폰",
  ...
}
```

### 7.4 버전 수정 플로우

```
사용자 → PUT /masters/:versionId
        {
          "name": "무선 이어폰 Pro",
          "basePrice": 60000
        }
        
        ↓
        
ProductMastersController
  → 1. ProductVersionsService.canUserModifyVersion()
       (권한 확인: draft + 소유자)
     2. ProductMastersService.updateMaster()
        - 필드 업데이트
        - updatedAt 갱신
        
        ↓
        
응답: {
  "id": "versionId_v2",
  "masterId": "masterId_A",
  "version": 2,
  "versionStatus": "draft",
  "name": "무선 이어폰 Pro",
  "basePrice": 60000,
  ...
}
```

### 7.5 가격 정책 설정 플로우

```
사용자 → PUT /products/:masterId/pricing
        {
          "basePriceRules": [...],
          "membershipPriceRules": [...],
          "tieredPriceRules": [...]
        }
        
        ↓
        
PricingController
  → PricingService.replaceMasterRules()
     ↓
     트랜잭션 시작
     1. Master 존재 확인
     2. 기존 가격 규칙 삭제 (매핑 삭제)
     3. 새 가격 규칙 생성
     4. 매핑 테이블에 연결
     5. 가격 유효성 검증
        - 모든 Variant 가격 계산
        - 음수/0원 체크
     트랜잭션 커밋
     
        ↓
        
응답: {
  "basePriceRules": [...],
  "membershipPriceRules": [...],
  "tieredPriceRules": [...]
}
```

### 7.6 가격 계산 플로우

```
사용자 → POST /products/:masterId/pricing/calculate
        {
          "variantId": "variant_xyz",
          "quantity": 10,
          "customerType": "membership"
        }
        
        ↓
        
PricingController
  → PricingCalculatorService.calculateVariantPrice()
     ↓
     1. Master의 가격 규칙 조회 (active 버전)
     2. basePrice에서 시작 (0원)
     3. Layer 1 (base_price) 규칙 순차 적용
        - scope 매칭 확인
        - 규칙 적용 (override/offset/scale)
     4. Layer 2 (membership_price) 규칙 적용
        - customerType='membership'인 경우만
     5. Layer 3 (tiered_price) 규칙 적용
        - quantity 조건 확인
     6. 최종 가격 반환
     
        ↓
        
응답: {
  "variantId": "variant_xyz",
  "price": 9500,
  "totalPrice": 95000,
  "appliedRules": [
    {
      "ruleId": "rule_1",
      "layer": "base_price",
      "order": 1,
      "priceBeforeRule": 0,
      "priceAfterRule": 10000
    },
    {
      "ruleId": "rule_2",
      "layer": "membership_price",
      "order": 1,
      "priceBeforeRule": 10000,
      "priceAfterRule": 9500
    }
  ],
  "priceBreakdown": {
    "initialPrice": 0,
    "afterBasePrice": 10000,
    "afterMembershipPrice": 9500
  }
}
```

### 7.7 버전 트리 조회 플로우

```
사용자 → GET /masters/:masterId/versions
        
        ↓
        
ProductVersionsController
  → ProductVersionsService.getVersionTree()
     ↓
     1. masterId로 모든 버전 조회
     2. Map으로 변환
     3. parentVersionId로 트리 구성
     4. 루트 노드들 반환
     
        ↓
        
응답: [
  {
    "id": "v1",
    "version": 1,
    "versionStatus": "inactive",
    "children": [
      {
        "id": "v2",
        "version": 2,
        "versionStatus": "active",
        "children": [...]
      },
      {
        "id": "v3",
        "version": 3,
        "versionStatus": "draft",
        "children": []
      }
    ]
  }
]
```

---

## 8. 주요 서비스 로직

### 8.1 ProductMastersService

판매 상품의 생성, 조회, 수정, 삭제를 담당합니다.

**주요 메소드:**

#### 8.1.1 createMaster()

```typescript
async createMaster(data: CreateMasterDto, tx?: DbTransaction): Promise<ProductMaster>
```

**기능 (간소화됨):**
- 빈 draft 상태로 첫 번째 버전 생성
- masterId와 versionId 별도 생성
- **기본 variant 1개만 생성** (옵션 없음, isDefault=true)
- WMS 이벤트 발행 (기본 variant)
- **비동기 처리 없음** - 모든 작업이 즉시 완료

**트랜잭션 처리:**
- 외부 tx가 있으면 재사용
- 없으면 새 트랜잭션 생성

**중요 변경사항:**
- 모든 필드가 선택사항 (빈 객체 `{}` 가능)
- 옵션은 update API의 `optionDiff`로 추가
- basePrice 제거 - 가격은 pricing rules만으로 결정

#### 8.1.2 updateMaster()

```typescript
async updateMaster(versionId: string, data: UpdateMasterDto, tx?: DbTransaction): Promise<ProductMaster>
```

**기능:**
- Draft 버전의 필드 수정
- OptionDiff 처리 (옵션 추가/수정/삭제)
- updatedAt 자동 갱신

**제약:**
- Draft 상태만 수정 가능 (컨트롤러에서 권한 확인)

#### 8.1.3 _generateVariants()

```typescript
private async _generateVariants(master: ProductMaster, optionGroups: any[], tx: DbTransaction): Promise<void>
```

**기능:**
- 옵션 조합 자동 계산
- Variant 레코드 생성
- 매핑 테이블 연결
- WMS 이벤트 발행

**알고리즘:**
- 재귀적으로 모든 조합 생성
- 옵션이 없으면 기본 Variant 1개 생성

#### 8.1.4 getClient()

```typescript
private getClient(tx?: DbTransaction)
```

**기능:**
- 트랜잭션 또는 기본 DB 클라이언트 반환
- 헬퍼 메소드

### 8.2 ProductVersionsService

버전 관리의 핵심 로직을 담당합니다.

**주요 메소드:**

#### 8.2.1 createDraftVersion()

```typescript
async createDraftVersion(
  parentVersionId: string,
  userId: string,
  copyMappings: boolean = true,
  tx?: DbTransaction
): Promise<ProductMaster>
```

**기능:**
- 부모 버전 기반 새 draft 생성
- 버전 번호 자동 증가
- 모든 필드 복사 (버전 관련 제외)
- 매핑 정보 복사 (옵션, Variant, 가격)
- draftOwnerId 설정

**매핑 복사:**
- `_copyMappings()`: 옵션/Variant/가격 매핑 복사
- `_copyOptionGroupDisplays()`: Display 정보 복사
- `_copyOptionValueDisplays()`: Display 정보 복사

#### 8.2.2 publishVersion()

```typescript
async publishVersion(
  versionId: string,
  targetStatus: 'active' | 'inactive',
  tx?: DbTransaction
): Promise<void>
```

**기능:**
- Draft를 active/inactive로 전환
- 기존 active 버전 자동 inactive 처리
- WMS 이벤트 발행 (Variant 변경사항)

**제약:**
- Draft 상태만 publish 가능

#### 8.2.3 getVersionTree()

```typescript
async getVersionTree(masterId: string, tx?: DbTransaction): Promise<VersionTreeNode[]>
```

**기능:**
- masterId의 모든 버전 조회
- parentVersionId로 트리 구조 생성
- 루트 노드들 반환

**알고리즘:**
1. 모든 버전을 Map에 저장
2. parentVersionId로 부모-자식 연결
3. 부모 없는 노드를 루트로

#### 8.2.4 compareVersions()

```typescript
async compareVersions(
  versionId1: string,
  versionId2: string,
  tx?: DbTransaction
): Promise<VersionDiffDto[]>
```

**기능:**
- 두 버전 간 필드별 차이 반환
- 25개 이상의 필드 비교
- JSON 직렬화로 비교

#### 8.2.5 canUserModifyVersion()

```typescript
async canUserModifyVersion(
  versionId: string,
  userId: string,
  tx?: DbTransaction
): Promise<boolean>
```

**기능:**
- Draft 상태 확인
- 소유자 권한 확인 (draftOwnerId)

**권한 규칙:**
- Draft가 아니면 false
- draftOwnerId가 null이면 누구나 수정 가능
- draftOwnerId가 설정되어 있으면 소유자만 수정 가능

#### 8.2.6 _publishVariantChangeEvents()

```typescript
private async _publishVariantChangeEvents(
  newVersion: ProductMaster,
  oldVersion: ProductMaster | null,
  tx: DbTransaction
): Promise<void>
```

**기능:**
- 버전 간 Variant 변경사항 추적
- 추가된 Variant: `ProductVariantCreated` 이벤트
- 삭제된 Variant: `ProductVariantDeleted` 이벤트

**WMS 연동:**
- WMS는 이벤트를 수신하여 SKU 매칭 생성/삭제

### 8.3 PricingCalculatorService

가격 계산 엔진입니다.

**주요 메소드:**

#### 8.3.1 calculateVariantPrice()

```typescript
async calculateVariantPrice(
  masterId: string,
  variantId: string,
  quantity?: number,
  customerType: 'regular' | 'membership' = 'regular',
  tx?: DbTransaction
): Promise<PriceCalculationResult>
```

**기능:**
- Variant의 최종 가격 계산
- 3단계 레이어 순차 적용
- 적용된 규칙 추적 (디버깅용)
- 가격 분해 정보 제공

**알고리즘:**
1. 0원에서 시작
2. base_price 레이어 규칙 순차 적용
3. membership_price 레이어 적용 (조건부)
4. tiered_price 레이어 적용 (수량 조건)
5. 최종 가격 반환

#### 8.3.2 calculateAllVariantsPrices()

```typescript
async calculateAllVariantsPrices(
  masterId: string,
  tx?: DbTransaction
): Promise<Map<string, { basePrice: number; membershipPrice: number }>>
```

**기능:**
- Master의 모든 Variant 가격 계산
- 일반가와 멤버십가 모두 계산
- Map 형태로 반환

**사용처:**
- 가격 정책 유효성 검증
- 대시보드 표시

#### 8.3.3 matchesScope()

```typescript
async matchesScope(
  variantId: string,
  rule: PricingRule,
  tx: DbTransaction
): Promise<boolean>
```

**기능:**
- 규칙이 Variant에 적용되는지 확인

**Scope 타입:**
- `all_variants`: 항상 true
- `with_option`: Variant가 특정 Option Value를 가지는지 확인
- `variants`: scopeTargetIds에 variantId가 포함되는지 확인

#### 8.3.4 applyRule()

```typescript
applyRule(currentPrice: number, rule: PricingRule): number
```

**기능:**
- 단일 규칙을 가격에 적용

**연산 타입:**
- `offset`: 더하기/빼기
- `scale`: 비율 적용 (1000배수)
- `override`: 고정 가격

#### 8.3.5 getRulesForMaster()

```typescript
async getRulesForMaster(
  masterId: string,
  layer?: 'base_price' | 'membership_price' | 'tiered_price',
  tx?: DbTransaction,
  version?: number
): Promise<{
  basePriceRules: PricingRule[];
  membershipPriceRules: PricingRule[];
  tieredPriceRules: PricingRule[];
}>
```

**기능:**
- Master의 모든 가격 규칙 조회
- 레이어별 필터링 가능
- version 지정 가능 (기본: active)

**매핑 테이블 JOIN:**
- `product_master_pricing_rules`를 통해 버전별 규칙 조회

### 8.4 PricingService

가격 정책의 CRUD를 담당합니다.

**주요 메소드:**

#### 8.4.1 replaceMasterRules()

```typescript
async replaceMasterRules(
  masterId: string,
  rulesDto: ReplacePricingRulesDto,
  version?: number,
  tx?: DbTransaction
): Promise<PricingRulesResponseDto>
```

**기능:**
- 기존 가격 규칙 삭제
- 새 가격 규칙 생성
- 매핑 테이블에 연결
- 가격 유효성 검증

**유효성 검증:**
- `PricingValidatorService.validateCalculatedPrices()` 호출
- 모든 Variant 가격 계산
- 음수/0원 체크

#### 8.4.2 getMasterRules()

```typescript
async getMasterRules(
  masterId: string,
  version?: number,
  tx?: DbTransaction
): Promise<PricingRulesResponseDto>
```

**기능:**
- Master의 가격 규칙 조회
- version 지정 가능 (기본: active)
- 레이어별로 그룹화하여 반환

#### 8.4.3 deleteMasterRules()

```typescript
async deleteMasterRules(
  masterId: string,
  version?: number,
  tx?: DbTransaction
): Promise<void>
```

**기능:**
- Master의 모든 가격 규칙 삭제
- 매핑 레코드 삭제
- 실제 규칙 레코드 삭제 (다른 버전에서 미사용 시)

---

## 9. 제약사항 및 주의사항

### 9.1 버전 관리 제약

#### 9.1.1 Active 버전은 하나만

```sql
-- 데이터베이스 제약
UNIQUE INDEX unique_master_active_version 
  ON product_masters (master_id) 
  WHERE version_status = 'active';
```

**의미:**
- masterId당 active 버전은 최대 1개
- 새 버전을 active로 전환 시 기존 active 자동 inactive 처리

**주의:**
- 동시에 두 버전을 active로 만들려는 시도는 DB 에러 발생

#### 9.1.2 Draft만 수정 가능

```typescript
// 컨트롤러에서 권한 확인 필수
const canModify = await this.productVersionsService.canUserModifyVersion(
  versionId,
  userId
);

if (!canModify) {
  throw new ForbiddenException(
    'Only draft versions can be modified.'
  );
}
```

**이유:**
- active/inactive 버전은 이미 외부에 노출되었을 수 있음
- 데이터 일관성 보장

**해결책:**
- 수정이 필요하면 새 draft 버전 생성

#### 9.1.3 버전 번호는 증가만

```typescript
const nextVersion = (maxVersionResult[0]?.max || 0) + 1;
```

**의미:**
- 버전 번호는 삭제되지 않음
- 항상 증가만 함
- 중간 버전 삭제해도 번호는 재사용 안 됨

**예시:**
```
v1 → v2 → v3 (v2 삭제) → v4 (v2 재사용 안 됨)
```

### 9.2 Variant 관련 제약

#### 9.2.1 Variant는 절대 삭제 안 됨

```typescript
// regenerateVariants에서도 매핑만 삭제
await txn.delete(productMasterVariants)
  .where(...);

// 실제 variant 레코드는 다른 버전에서 사용 중이면 유지
```

**이유:**
- WMS는 variantId로 SKU와 매칭
- variantId가 삭제되면 WMS 데이터 고아 발생

**해결책:**
- 매핑 테이블만 제거
- Variant 레코드는 status='inactive'로 변경

#### 9.2.2 Variant 조합은 자동 생성

```typescript
// 수동으로 Variant 생성 불가
// 옵션 정의 → 자동 생성만 가능
```

**이유:**
- 일관성 보장
- 옵션과 Variant 동기화

**예외:**
- 옵션 없는 상품: 기본 Variant 1개 자동 생성

### 9.3 가격 정책 제약

#### 9.3.1 가격은 양수여야 함

```typescript
// PricingValidatorService
if (baseResult.price <= 0) {
  throw new BadRequestException(
    `Variant ${variant.id}: base price must be > 0`
  );
}
```

**검증 시점:**
- 가격 정책 저장 시
- `validateCalculatedPrices()` 호출

**예외:**
- 멤버십가는 0원 허용 (무료 제공 가능)

#### 9.3.2 레이어별 순서 지켜야 함

```typescript
// Layer 1 (base_price) → Layer 2 (membership_price) → Layer 3 (tiered_price)
// 순서 바뀌면 계산 결과 달라짐
```

**order 필드:**
- 레이어 내에서의 순서
- 작은 숫자부터 적용

#### 9.3.3 Override는 신중하게

```typescript
// override 연산은 이전 계산 무시
{
  "operationType": "override",
  "operationValue": 15000
}
```

**주의:**
- 이전 레이어의 모든 계산 결과 무시
- 일반적으로 레이어의 첫 번째 규칙으로 사용

### 9.4 트랜잭션 관리

#### 9.4.1 모든 메소드에 tx 파라미터

```typescript
async methodName(...args, tx?: DbTransaction): Promise<Result> {
  return this.inTx(async (tx) => {
    // 로직
  }, tx);
}
```

**이유:**
- 상위에서 시작한 트랜잭션 전파
- 원자성 보장

**패턴:**
- tx 있으면 재사용
- 없으면 새 트랜잭션 생성

#### 9.4.2 중첩 트랜잭션 주의

```typescript
// 올바른 패턴
await this.service1.method1(data, tx);  // tx 전달
await this.service2.method2(data, tx);  // 동일 tx

// 잘못된 패턴
await this.service1.method1(data);  // 새 tx 생성
await this.service2.method2(data);  // 또 다른 tx 생성
```

**문제:**
- 원자성 깨짐
- 데이터 불일치 가능

### 9.5 외부 시스템 연동

#### 9.5.1 WMS는 masterId 참조

```typescript
// WMS는 물리적 버전 ID가 아닌 논리적 masterId 참조
export interface WmsSkuMapping {
  masterId: string;  // ✅
  variantId: string;
  skuId: string;
}
```

**이유:**
- 버전이 바뀌어도 동일 상품으로 인식
- SKU 매칭 유지

#### 9.5.2 채널은 active 버전만 조회

```typescript
// channel_products 조인 시 active 버전 필터링
.innerJoin(
  productMasters,
  and(
    eq(channelProducts.masterId, productMasters.masterId),
    eq(productMasters.versionStatus, 'active')
  )
)
```

**이유:**
- 외부에는 현재 active 버전만 노출
- draft는 내부 작업용

#### 9.5.3 이벤트 발행 실패는 무시

```typescript
try {
  await this.productPublisher.publishEvent(...);
} catch (error) {
  this.logger.error('Failed to publish event', error);
  // 트랜잭션은 커밋됨
}
```

**이유:**
- 이벤트 발행 실패로 전체 트랜잭션 롤백 방지
- Orchestrator가 WMS에 직접 요청하므로 복원력 보장

### 9.6 성능 고려사항

#### 9.6.1 인덱스 활용

```sql
-- masterId로 조회 시 인덱스 사용
idx_masters_master_id (masterId)
idx_masters_master_id_version (masterId, version)
```

**최적화:**
- WHERE masterId = ? AND version = ? (빠름)
- WHERE id = ? (PK, 가장 빠름)

#### 9.6.2 버전 수 증가 시 쿼리 최적화

```typescript
// 필요한 버전만 조회
WHERE master_id = ? AND version_status = 'active'  // 1개
WHERE master_id = ? AND version_status IN ('active', 'draft')  // 2~3개

// 모든 버전 조회는 최소화
WHERE master_id = ?  // 수십 개 가능
```

#### 9.6.3 가격 계산 캐싱

```typescript
// 자주 조회되는 가격은 캐시 고려
// 현재는 미구현, 향후 Redis 캐시 추가 예정
```

### 9.7 데이터 마이그레이션

#### 9.7.1 기존 데이터 호환성

```sql
-- 기존 데이터는 masterId = id로 설정 가능 (하위 호환)
UPDATE product_masters
SET master_id = id,
    version = 1,
    version_status = 'active',
    parent_version_id = NULL
WHERE master_id IS NULL;
```

**주의:**
- 신규 데이터는 masterId 별도 생성
- 기존 데이터는 일관성 유지 위해 masterId = id 허용

#### 9.7.2 매핑 테이블 마이그레이션

```sql
-- 기존 FK를 매핑 테이블로 이관
INSERT INTO product_master_option_groups (id, master_id, option_group_id, version)
SELECT gen_random_uuid(), og.master_id, og.id, 1
FROM product_option_groups og
WHERE og.master_id IS NOT NULL;
```

**순서:**
1. 매핑 테이블 생성
2. 기존 관계 복사
3. 기존 FK 제거 (nullable로 변경)

---

## 10. 참고 자료

### 10.1 주요 파일 목록

#### 스키마 및 타입
- `apps/pim/src/schema.ts` - 데이터베이스 스키마 정의
- `apps/pim/src/types.ts` - TypeScript 타입 정의

#### 서비스
- `apps/pim/src/core/products/services/product-masters.service.ts` - Master 상품 관리
- `apps/pim/src/core/products/services/product-versions.service.ts` - 버전 관리
- `apps/pim/src/core/products/services/product-variants.service.ts` - 품목 관리
- `apps/pim/src/core/pricing/pricing.service.ts` - 가격 정책 관리
- `apps/pim/src/core/pricing/pricing-calculator.service.ts` - 가격 계산 엔진
- `apps/pim/src/core/pricing/pricing-validator.service.ts` - 가격 유효성 검증

#### 컨트롤러
- `apps/pim/src/core/products/controllers/product-masters.controller.ts`
- `apps/pim/src/core/products/controllers/product-versions.controller.ts`
- `apps/pim/src/core/products/controllers/product-variants.controller.ts`
- `apps/pim/src/core/pricing/pricing.controller.ts`

#### DTO
- `apps/pim/src/core/products/dto/masters/` - Master 관련 DTO
- `apps/pim/src/core/products/dto/versions/` - 버전 관련 DTO
- `apps/pim/src/core/products/dto/variants/` - Variant 관련 DTO
- `apps/pim/src/core/pricing/dto/` - 가격 관련 DTO

### 10.2 관련 문서

- `IMPLEMENTATION_SUMMARY_VERSION_MANAGEMENT.md` - 버전 관리 구현 요약
- `.cursor/rules/wms-core-query-and-tx.mdc` - 서비스 클래스 리팩토링 규칙
- `.cursor/rules/wms-docs.mdc` - WMS 구조 파악 가이드

### 10.3 핵심 타입 참조

#### VersionTreeNode

```typescript
export interface VersionTreeNode {
  id: string;
  masterId: string;
  version: number;
  versionStatus: VersionStatus;
  name: string;
  parentVersionId: string | null;
  children: VersionTreeNode[];
  createdAt: Date;
  updatedAt: Date;
  draftOwnerId?: string | null;
}
```

#### PriceCalculationResult

```typescript
export interface PriceCalculationResult {
  variantId: string;
  price: number;
  totalPrice?: number;
  appliedRules: AppliedRuleInfo[];
  priceBreakdown: {
    initialPrice: number;
    afterBasePrice: number;
    afterMembershipPrice?: number;
    afterTieredPrice?: number;
  };
}
```

#### OptionDiff

```typescript
export interface OptionDiff {
  add?: AddOptionDto[];
  modifyDisplay?: ModifyOptionDisplayDto[];
  addValues?: AddOptionValuesDto[];
  removeValues?: RemoveOptionValuesDto[];
  remove?: string[];
}
```

### 10.4 데이터베이스 스키마 다이어그램

전체 ERD는 섹션 3.4를 참조하세요.

### 10.5 API 엔드포인트 요약

#### Product Masters
- `POST /masters` - 상품 생성
- `GET /masters/:id` - 상품 조회
- `PUT /masters/:id` - 상품 수정 (draft만)
- `DELETE /masters/:id` - 상품 삭제

#### Product Versions
- `GET /masters/:masterId/versions` - 버전 트리 조회
- `GET /masters/:masterId/versions/active` - Active 버전 조회
- `POST /masters/:masterId/versions` - Draft 버전 생성
- `PATCH /masters/:masterId/versions/:versionId/publish` - 버전 Publish
- `GET /masters/:masterId/versions/:versionId/compare/:compareVersionId` - 버전 비교

#### Pricing
- `GET /products/:masterId/pricing` - 가격 정책 조회
- `PUT /products/:masterId/pricing` - 가격 정책 설정
- `DELETE /products/:masterId/pricing` - 가격 정책 삭제
- `POST /products/:masterId/pricing/calculate` - 가격 계산

### 10.6 트러블슈팅

#### 문제: Active 버전을 수정할 수 없음

```
Error: Only draft versions can be modified
```

**해결:**
1. 새 draft 버전 생성
2. draft 버전 수정
3. publish

#### 문제: 가격이 0원으로 계산됨

```
Error: Variant price is 0 (must be > 0)
```

**원인:**
- base_price 레이어에 규칙이 없음

**해결:**
- base_price 레이어에 override 규칙 추가

```json
{
  "layer": "base_price",
  "order": 1,
  "scopeType": "all_variants",
  "operationType": "override",
  "operationValue": 10000
}
```

#### 문제: Variant가 생성되지 않음

**원인:**
- 옵션 정의가 없거나 잘못됨

**확인:**
- `POST /masters` 시 optionGroups 포함했는지
- optionGroups.values 배열이 비어있지 않은지

#### 문제: 버전 트리가 깨짐

**원인:**
- parentVersionId가 존재하지 않는 버전을 가리킴

**해결:**
- 트리 조회 로직은 자동으로 복구 (고아 노드는 루트로)
- 데이터 정합성 체크 필요

### 10.7 향후 개선 사항

1. **성능 최적화**
   - 가격 계산 결과 캐싱 (Redis)
   - 버전 조회 최적화 (Materialized View)

2. **기능 추가**
   - 버전 비교 UI
   - 자동 Draft 정리 (오래된 draft 삭제)
   - A/B 테스트 지원

3. **감사 기능**
   - 버전별 변경 이력 상세 추적
   - 롤백 기능

4. **이벤트 시스템**
   - 버전 생성/publish 이벤트 발행
   - 외부 시스템 자동 알림

---

## 마치며

이 문서는 PIM 상품 버전 관리 시스템의 전체 구조를 설명합니다. 
코드를 직접 보지 않고도 시스템의 동작 방식을 이해할 수 있도록 작성되었습니다.

**질문이나 개선사항이 있다면:**
- GitHub Issue 생성
- 구글 Chat 발사 

**마지막 업데이트:** 2025-11-17

---

