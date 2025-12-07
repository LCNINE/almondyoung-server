# PIM 상품 등록 및 수정 플로우

이 문서는 PIM에서 상품이 등록되고 수정되는 전체 과정을 설명합니다.

---

## 📋 목차

1. [상품 등록 (Master 생성)](#1-상품-등록-master-생성)
2. [상품 수정 (Draft 버전 수정)](#2-상품-수정-draft-버전-수정)
3. [Variant 생성 로직](#3-variant-생성-로직)
4. [버전 Publish (Draft → Active)](#4-버전-publish-draft--active)
5. [전체 워크플로우](#5-전체-워크플로우)

---

## 1. 상품 등록 (Master 생성)

### 엔드포인트
```
POST /masters
```

### 요청
```json
{}
```
모든 필드는 선택사항입니다. 빈 객체로도 생성 가능합니다.

### 처리 과정

1. **Master 메타데이터 생성**
   - `product_masters` 테이블에 레코드 생성
   - Master ID 생성 (UUID v7)

2. **첫 번째 버전 생성**
   - `product_master_versions` 테이블에 레코드 생성
   - Version ID 생성 (UUID v7)
   - 상태: `draft`
   - 버전 번호: 1

3. **기본 Variant 생성**
   - `product_variants` 테이블에 기본 variant 1개 생성
   - 옵션이 없는 기본 품목 (`isDefault: true`)
   - `product_master_variants` 매핑 테이블에 연결

4. **WMS 이벤트 발행**
   - `ProductVariantCreated` 이벤트를 Kafka로 발행
   - WMS에서 자동으로 매칭 대기 상태 생성

### 응답
```json
{
  "id": "version-uuid",
  "masterId": "master-uuid",
  "version": 1,
  "status": "draft",
  "name": null,
  "createdAt": "2025-01-20T10:00:00Z"
}
```

---

## 2. 상품 수정 (Draft 버전 수정)

### 엔드포인트
```
PUT /masters/:masterId/versions/:versionId
```

### 요청 예시
```json
{
  "name": "수정된 상품명",
  "description": "상품 설명",
  "brand": "브랜드명",
  "categoryIds": ["category-uuid-1", "category-uuid-2"],
  "primaryCategoryId": "category-uuid-1",
  "thumbnailFileId": "file-uuid",
  "additionalImageFileIds": ["file-uuid-1", "file-uuid-2"],
  "optionDiff": {
    "add": [
      {
        "optionGroupId": "option-group-uuid",
        "displayName": "색상",
        "optionValueIds": ["value-uuid-1", "value-uuid-2"]
      }
    ],
    "remove": ["option-group-uuid-2"]
  },
  "tagValueIds": ["tag-value-uuid-1", "tag-value-uuid-2"]
}
```

### 처리 과정

1. **Draft 상태 검증**
   - Draft 버전만 수정 가능
   - Active/Inactive 버전은 수정 불가 (불변성 원칙)

2. **기본 필드 수정**
   - `product_master_versions` 테이블 업데이트
   - `name`, `description`, `brand`, `thumbnailFileId` 등

3. **카테고리 업데이트**
   - 기존 카테고리 매핑 삭제
   - 새로운 카테고리 매핑 생성
   - `product_master_categories` 테이블 관리

4. **옵션 Diff 처리**
   - 옵션 그룹 추가/제거/수정
   - 옵션 구조 변경 시 **모든 Variant 재생성**
   - `product_master_option_groups` 매핑 관리
   - `product_option_group_displays` 관리

5. **태그 업데이트**
   - 기존 태그 매핑 삭제
   - 새로운 태그 매핑 생성
   - `product_tag_values` 테이블 관리

### 수정 가능한 항목

| 항목 | 필드명 | 설명 |
|------|--------|------|
| 기본 정보 | `name`, `description`, `brand` | 상품 기본 정보 |
| 이미지 | `thumbnailFileId`, `additionalImageFileIds` | 썸네일 및 추가 이미지 |
| 카테고리 | `categoryIds`, `primaryCategoryId` | 카테고리 연결 |
| 옵션 | `optionDiff` | 옵션 그룹 추가/제거/수정 |
| 태그 | `tagValueIds` | 태그 값 연결 |
| SEO | `seoTitle`, `seoDescription`, `seoKeywords` | SEO 메타데이터 |
| 기타 | `attributes`, `isWholesaleOnly`, `isMembershipOnly` 등 | 추가 속성 |

---

## 3. Variant 생성 로직

### 옵션이 없는 경우

- 기본 variant 1개 생성
- `isDefault: true`
- `variantName: null`

### 옵션이 있는 경우

모든 옵션 조합으로 variant 자동 생성

**예시:**
- 옵션 그룹 1: 색상 (빨강, 파랑)
- 옵션 그룹 2: 사이즈 (S, M)

**생성되는 Variant:**
1. 빨강 × S
2. 빨강 × M
3. 파랑 × S
4. 파랑 × M

### Variant 생성 시 처리

1. **Variant 엔티티 생성**
   - `product_variants` 테이블에 레코드 생성
   - `variantName`: 옵션 조합 이름 (예: "빨강 × S")

2. **Master와 연결**
   - `product_master_variants` 매핑 테이블에 연결

3. **옵션 값 연결**
   - `variant_option_values` 테이블에 각 옵션 값 연결

4. **WMS 이벤트 발행**
   - 각 variant마다 `ProductVariantCreated` 이벤트 발행

### 옵션 변경 시 Variant 재생성

- 옵션 그룹 추가/제거 → 모든 variant 재생성
- 옵션 값 변경 → 모든 variant 재생성
- 기존 variant 삭제 후 새로 생성

---

## 4. 버전 Publish (Draft → Active)

### 엔드포인트
```
PATCH /masters/:masterId/versions/:versionId/publish
```

### 처리 과정

1. **Draft 상태 검증**
   - Draft 버전만 publish 가능

2. **기존 Active 버전 처리**
   - 기존 Active 버전이 있으면 자동으로 Inactive로 전환
   - Master당 Active 버전은 최대 1개

3. **Draft → Active 전환**
   - 버전 상태를 `active`로 변경
   - `draftOwnerId` 제거

4. **이벤트 발행**
   - Variant 변경 이벤트 발행 (추가/삭제된 variant)
   - `ProductMasterActiveVersionChanged` 이벤트 발행
   - 채널 동기화 트리거

### 응답
```json
{
  "message": "Version published successfully",
  "masterId": "master-uuid",
  "versionId": "version-uuid",
  "version": 1,
  "newStatus": "active"
}
```

---

## 5. 전체 워크플로우

### 일반적인 상품 등록 플로우

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: 상품 생성                                            │
│ POST /masters {}                                             │
│ → Master + Draft Version 1 생성                             │
│ → 기본 Variant 1개 생성                                      │
│ → WMS 이벤트 발행                                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: 상품 정보 수정                                        │
│ PUT /masters/:masterId/versions/:versionId                   │
│ {                                                             │
│   name: "상품명",                                             │
│   description: "설명",                                        │
│   categoryIds: [...],                                        │
│   optionDiff: { add: [...] }                                 │
│ }                                                             │
│ → Draft 버전 수정                                             │
│ → 옵션 변경 시 Variant 재생성                                 │
│ → WMS 이벤트 발행                                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: 가격 정책 설정 (선택)                                 │
│ PUT /products/:masterId/pricing-rules                        │
│ {                                                             │
│   basePriceRules: [...]                                      │
│ }                                                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: 상품 공개                                            │
│ PATCH /masters/:masterId/versions/:versionId/publish         │
│ → Draft → Active 전환                                         │
│ → 기존 Active → Inactive                                     │
│ → 이벤트 발행 (채널 동기화 등)                                │
└─────────────────────────────────────────────────────────────┘
```

### 버전 관리 상태 전환

```
┌─────────┐
│  Draft  │ ← 수정 가능
└────┬────┘
     │ Publish
     ↓
┌─────────┐
│ Active  │ ← 공개된 상품 (수정 불가)
└────┬────┘
     │ Unpublish
     ↓
┌──────────┐
│ Inactive │ ← 비공개 상품 (수정 불가)
└──────────┘
```

**상태별 특징:**

| 상태 | 수정 가능 | 공개 여부 | 설명 |
|------|----------|----------|------|
| Draft | ✅ | ❌ | 임시 저장 상태, 수정 가능 |
| Active | ❌ | ✅ | 공개된 상품, 수정 불가 |
| Inactive | ❌ | ❌ | 비공개 상품, 수정 불가 |

**중요 규칙:**
- Draft 버전만 수정 가능
- Active/Inactive 버전은 불변 (수정 불가)
- 수정하려면 새 Draft 버전 생성 필요

---

## 주요 특징

### 1. 버전 관리
- Master는 여러 Version을 가질 수 있음
- Active 버전은 Master당 최대 1개
- 버전별로 독립적인 옵션, variant, 카테고리 관리

### 2. Draft 기반 수정
- Draft 버전만 수정 가능
- Active/Inactive 버전은 불변 (불변성 원칙)
- 수정 후 Publish하여 공개

### 3. Variant 자동 생성
- 옵션 조합으로 자동 생성
- 옵션 변경 시 자동 재생성
- 옵션이 없으면 기본 variant 1개

### 4. 이벤트 기반 통합
- WMS와 Kafka 이벤트로 통합
- Variant 생성 시 자동 매칭 대기 상태 생성
- 버전 변경 시 채널 동기화

### 5. 트랜잭션 보장
- 모든 작업이 트랜잭션으로 처리
- 일관성 보장
- 실패 시 롤백

---

## 관련 문서

- [API 설계 가이드](./API_DESIGN_GUIDE.md)
- [버전 관리 가이드](../PIM_VERSION_MANAGEMENT_GUIDE.md)

