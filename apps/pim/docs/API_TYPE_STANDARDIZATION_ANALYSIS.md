# PIM Core API 타입 표준화 분석 결과

**분석 일자:** 2025-12-05
**분석 범위:** `apps/pim/src/core`
**분석 대상:** 57개 DTO 파일, 핵심 컨트롤러 및 서비스

---

## 목차

1. [개요](#개요)
2. [주요 문제점](#주요-문제점)
3. [개선 우선순위](#개선-우선순위)
4. [구체적 액션 아이템](#구체적-액션-아이템)
5. [참고 자료](#참고-자료)

---

## 개요

PIM Core 모듈의 API 타입들을 분석한 결과, 여러 리팩토링을 거치며 발생한 기술적 부채로 인해 타입 정의와 사용 방식이 일관되지 않은 상태입니다. 이 문서는 발견된 문제점들을 우선순위별로 정리하고, 표준화를 위한 구체적인 개선 방안을 제시합니다.

---

## 주요 문제점

### 🔴 1. 응답 타입 네이밍 불일치

**문제 상세:**

List 응답 DTO의 데이터 필드명이 일관되지 않습니다.

**현황:**
- `data` 사용:
  - `MasterListResponseDto` (apps/pim/src/core/products/dto/masters/master-response.dto.ts:247)
  - `ChannelProductListResponseDto` (apps/pim/src/core/channels/dto/channel-products/channel-product-response.dto.ts:121)
  - `ChannelListResponseDto` (apps/pim/src/core/channels/dto/sales-channels/sales-channel-response.dto.ts:68)

- `items` 사용:
  - `ChannelListingListResponseDto` (apps/pim/src/core/channels/dto/channel-listings/channel-listing-response.dto.ts:89)

**영향:**
- 프론트엔드에서 API 응답을 처리할 때 필드명을 개별적으로 기억해야 함
- 일관된 타입 추상화가 어려워 제네릭 타입 활용 불가
- 코드 리뷰 시 혼란 초래

**권장 해결 방안:**

```typescript
// apps/pim/src/common/dto/base.dto.ts
export interface PaginatedResponse<T> {
  data: T[];      // 'data'로 통일 권장
  total: number;
  page: number;
  limit: number;
}

// 사용 예시
export class MasterListResponseDto implements PaginatedResponse<MasterListItemDto> {
  @ApiProperty({ description: '제품 마스터 목록', type: [MasterListItemDto] })
  data: MasterListItemDto[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}
```

---

### 🔴 2. 날짜 필드 타입 불일치 ⚠️ **가장 심각**

**문제 상세:**

같은 엔티티의 날짜 필드가 DTO마다 다른 타입을 사용하며, 심지어 같은 도메인 내에서도 `Date`와 `string` 타입이 혼재되어 있습니다.

**현황 분석:**

#### Categories 도메인 (일관됨 ✅)
```typescript
// apps/pim/src/core/categories/dto/category-response.dto.ts
createdAt: Date
updatedAt: Date
```

#### Products 도메인 (혼재 ❌)
```typescript
// apps/pim/src/core/products/dto/products/product-response.dto.ts:58
// ProductDto
createdAt: string
updatedAt: string
deletedAt: string | null

// apps/pim/src/core/products/dto/masters/master-response.dto.ts
// ProductMasterDto
createdAt: Date | null
updatedAt: Date | null

// MasterListItemDto
createdAt: string | null
```

#### Channels 도메인
```typescript
// apps/pim/src/core/channels/dto/sales-channels/sales-channel-response.dto.ts:62
// SalesChannelDto
createdAt: Date
updatedAt: Date

// apps/pim/src/core/channels/dto/channel-products/channel-product-response.dto.ts:23
// ChannelProductDto
createdAt: Date | null
updatedAt: Date | null
```

**문제점:**
- **타입 불일치**: Products 도메인에서 `ProductDto`는 string, `ProductMasterDto`는 Date 사용
- **혼란 유발**: 같은 API 응답에 두 타입이 섞여 있으면 직렬화/역직렬화 시 오류 발생 가능
- **Nullable 일관성 없음**: 어떤 DTO는 `Date`, 어떤 DTO는 `Date | null`

**권장 해결 방안:**

**원칙:**
- ✅ **ISO 8601 문자열로 통일** (JSON 직렬화 표준)
- ✅ 모든 Response DTO의 날짜 필드는 `string` 타입 사용
- ✅ Nullable 정책 명확화

```typescript
// apps/pim/src/common/dto/base.dto.ts
export interface BaseTimestamps {
  /** 생성일시 (ISO 8601 형식) */
  createdAt: string;

  /** 수정일시 (ISO 8601 형식) */
  updatedAt: string;
}

export interface SoftDeletable {
  /** 삭제일시 (ISO 8601 형식, 소프트 삭제 시에만 값 존재) */
  deletedAt: string | null;
}

// 사용 예시
export class ProductMasterDto implements BaseTimestamps {
  @ApiProperty({ description: '제품 마스터 ID' })
  id: string;

  @ApiProperty({ description: '제품 마스터 이름' })
  name: string;

  @ApiProperty({ description: '생성일시', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}
```

**마이그레이션 가이드:**
```typescript
// 서비스 레이어에서 Date → string 변환
return {
  ...entity,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  deletedAt: entity.deletedAt?.toISOString() ?? null,
};
```

---

### 🔴 3. Nullable 정책 불일치

**문제 상세:**

동일한 성격의 필드가 DTO마다 nullable 여부가 다릅니다.

**현황 분석:**

#### isActive 필드
```typescript
// CategoryResponseDto - not null
isActive: boolean

// ChannelProductDto - nullable
isActive: boolean | null

// SalesChannelDto - not null
isActive: boolean
```

#### 날짜 필드
```typescript
// CategoryResponseDto - not null
createdAt: Date
updatedAt: Date

// ProductMasterDto - nullable
createdAt: Date | null
updatedAt: Date | null

// ChannelProductDto - nullable
createdAt: Date | null
updatedAt: Date | null
```

#### description 필드 (일관됨 ✅)
```typescript
// 대부분의 DTO에서 일관되게 nullable
description: string | null
```

**권장 해결 방안:**

**도메인 규칙 명확화:**

| 필드 타입 | Nullable 정책 | 근거 |
|----------|--------------|------|
| `createdAt`, `updatedAt` | **NOT NULL** | 엔티티 생성/수정 시 자동으로 설정되므로 항상 존재 |
| `deletedAt` | **NULLABLE** | 소프트 삭제 시에만 값이 존재 |
| `isActive` | **NOT NULL** (기본값 사용) | Boolean 필드는 true/false 중 하나의 값을 항상 가져야 함 |
| `description`, `notes` 등 | **NULLABLE** | 선택적 비즈니스 필드 |
| `parentId`, 외래키 | **NULLABLE** | 관계가 선택적인 경우 |

**표준 타입 정의:**

```typescript
// apps/pim/src/common/dto/base.dto.ts

/** 모든 엔티티의 기본 타임스탬프 (항상 존재) */
export interface BaseTimestamps {
  createdAt: string;
  updatedAt: string;
}

/** 소프트 삭제를 지원하는 엔티티 */
export interface SoftDeletable extends BaseTimestamps {
  deletedAt: string | null;
}

/** 활성 상태를 가지는 엔티티 */
export interface Activatable {
  isActive: boolean;  // NOT NULL, 기본값 true
}

/** 설명 필드를 가지는 엔티티 */
export interface Describable {
  description: string | null;  // NULLABLE, 선택적 필드
}
```

---

### 🔴 4. 중복된 DTO 정의

**문제 상세:**

유사한 엔티티를 표현하는 DTO가 여러 개 존재하며, 명확한 구분 없이 혼용되고 있습니다.

**현황 분석:**

#### Products 도메인
```typescript
// apps/pim/src/core/products/dto/masters/master-response.dto.ts:4
export class ProductMasterDto { /* ... */ }

// apps/pim/src/core/products/dto/products/product-response.dto.ts:5
export class ProductDto { /* Master + Version 혼재 */ }

// apps/pim/src/core/products/dto/products/product-response.dto.ts:102
export class MasterProductWithPrimaryVersionDto { /* ... */ }
```

**문제점:**
- Master와 Version 개념이 혼재되어 있음
- 언제 어떤 DTO를 사용해야 하는지 불명확
- 유사한 필드가 중복 정의됨

#### Variants
```typescript
// apps/pim/src/core/products/dto/variants/variant-response.dto.ts:3
export class ProductVariantDto { /* ... */ }

// apps/pim/src/core/products/dto/masters/master-response.dto.ts:108
export class VariantDto { /* ProductVariantDto와 거의 동일 */ }
```

**권장 해결 방안:**

**네이밍 컨벤션 확립:**

```typescript
// apps/pim/src/core/products/dto/products/

/** 제품 마스터 기본 정보 (공통 필드) */
export class ProductMasterBaseDto {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 제품 마스터 요약 정보 (리스트용) */
export class ProductMasterSummaryDto extends ProductMasterBaseDto {
  thumbnail: string | null;
  status: string;
  variantCount: number;
}

/** 제품 마스터 상세 정보 (상세 조회용) */
export class ProductMasterDetailDto extends ProductMasterBaseDto {
  images: ProductImages;
  attributes: Record<string, any>;
  seoTitle: string | null;
  seoDescription: string | null;

  // 관계 데이터
  versions: ProductVersionSummaryDto[];
  variants: ProductVariantDto[];
  channelProducts: ChannelProductDto[];
}

/** 제품 버전 정보 (Master와 명확히 구분) */
export class ProductVersionDto {
  id: string;           // Version ID
  masterId: string;     // 참조하는 Master ID
  version: number;
  status: 'draft' | 'inactive' | 'active';
  // ... 버전별 데이터
}
```

**파일 구조 정리:**

```
apps/pim/src/core/products/dto/
├── base/
│   ├── product-master-base.dto.ts      # 공통 베이스
│   └── product-version-base.dto.ts
├── masters/
│   ├── product-master-summary.dto.ts   # 리스트용
│   └── product-master-detail.dto.ts    # 상세용
├── versions/
│   ├── product-version-summary.dto.ts
│   └── product-version-detail.dto.ts
└── variants/
    ├── product-variant.dto.ts          # 단일 DTO로 통일
    └── product-variant-detail.dto.ts
```

---

### 🟡 5. 페이지네이션 필드 순서 불일치

**문제 상세:**

페이지네이션 응답 DTO의 필드 순서가 제각각입니다.

**현황:**

```typescript
// apps/pim/src/core/products/dto/masters/master-response.dto.ts:247
export class MasterListResponseDto {
  data: MasterListItemDto[];
  page: number;
  limit: number;
  total: number;
}

// apps/pim/src/core/channels/dto/sales-channels/sales-channel-response.dto.ts:68
export class ChannelListResponseDto {
  data: SalesChannelDto[];
  total: number;
  page: number;
  limit: number;
}

// apps/pim/src/core/products/dto/variants/variant-response.dto.ts:40
export class VariantListResponseDto {
  data: VariantWithPriceDto[];
  total: number;
  page: number;
  limit: number;
}
```

**권장 해결 방안:**

**표준 순서 정의:**

```typescript
// apps/pim/src/common/dto/pagination.dto.ts

export interface PaginatedResponse<T> {
  /** 데이터 배열 */
  data: T[];

  /** 전체 아이템 수 */
  total: number;

  /** 현재 페이지 번호 (1부터 시작) */
  page: number;

  /** 페이지당 아이템 수 */
  limit: number;
}

// 사용 예시
export class MasterListResponseDto implements PaginatedResponse<MasterListItemDto> {
  @ApiProperty({ description: '제품 마스터 목록', type: [MasterListItemDto] })
  data: MasterListItemDto[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}
```

**필드 순서 규칙:**
1. `data` - 실제 데이터 (가장 중요)
2. `total` - 전체 개수 (페이지네이션 UI에 필요)
3. `page` - 현재 페이지
4. `limit` - 페이지 크기

---

### 🟡 6. JSONB 필드의 any 타입 남용

**문제 상세:**

구조화된 데이터를 `any` 타입으로 정의하여 타입 안정성이 떨어집니다.

**현황:**

```typescript
// apps/pim/src/core/products/dto/masters/master-response.dto.ts
export class ProductMasterDto {
  @ApiProperty({ description: '제품 이미지 (JSONB)' })
  images: any;  // ❌

  @ApiProperty({ description: '제품 속성 (JSONB)' })
  attributes: any;  // ❌
}

// apps/pim/src/core/channels/dto/channel-products/channel-product-response.dto.ts
export class ChannelProductDto {
  @ApiProperty({ description: '채널별 특화 데이터' })
  channelSpecificData: any;  // ❌
}

// apps/pim/src/core/channels/dto/sales-channels/sales-channel-response.dto.ts
export class SalesChannelDto {
  @ApiProperty({ description: '채널 설정' })
  config: Record<string, any>;  // ⚠️ 조금 나음

  @ApiProperty({ description: '인증 정보' })
  credentials: Record<string, any>;  // ⚠️
}
```

**권장 해결 방안:**

**1단계: 최소한 Record 타입 사용**

```typescript
export class ProductMasterDto {
  @ApiProperty({ description: '제품 이미지' })
  images: Record<string, unknown>;  // any 대신 unknown

  @ApiProperty({ description: '제품 속성' })
  attributes: Record<string, unknown>;
}
```

**2단계: 구조화된 타입 정의 (권장)**

```typescript
// apps/pim/src/core/products/dto/common/product-images.dto.ts

export interface ImageInfo {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  size?: number;
}

export interface ProductImages {
  /** 대표 이미지 */
  primary?: ImageInfo;

  /** 추가 이미지 목록 */
  additional?: ImageInfo[];

  /** 썸네일 이미지 */
  thumbnail?: ImageInfo;
}

// 사용
export class ProductMasterDto {
  @ApiProperty({ description: '제품 이미지', type: 'object' })
  images: ProductImages;
}
```

**3단계: 자주 사용되는 구조는 별도 정의**

```typescript
// apps/pim/src/core/channels/dto/common/channel-config.dto.ts

export interface SenderInfo {
  name: string;
  phone: string;
  zipcode: string;
  address: string;
  detailAddress?: string;
}

export interface ChannelConfig {
  sender?: SenderInfo;
  apiKey?: string;
  secretKey?: string;
  [key: string]: unknown;  // 확장 가능하도록
}

// 사용
export class SalesChannelDto {
  @ApiProperty({
    description: '채널 설정',
    type: 'object',
    example: {
      sender: {
        name: '아몬드영',
        phone: '010-1234-5678',
        zipcode: '12345',
        address: '서울시 강남구',
        detailAddress: '101호'
      }
    }
  })
  config: ChannelConfig;
}
```

---

### 🟢 7. 잘 되어 있는 부분

**긍정적인 점들:**

1. ✅ **Swagger 데코레이터 잘 적용됨**
   - 모든 DTO 필드에 `@ApiProperty` 사용
   - 설명(description)이 한글로 명확하게 작성됨
   - 예시(example) 값 제공

2. ✅ **DTO 파일이 도메인별로 잘 분리됨**
   ```
   apps/pim/src/core/
   ├── products/dto/
   ├── categories/dto/
   ├── channels/dto/
   ├── tags/dto/
   └── pricing/dto/
   ```

3. ✅ **Response DTO 네이밍 컨벤션 일관됨**
   - `*ResponseDto` - 단일 응답
   - `*ListResponseDto` - 목록 응답
   - `*DetailResponseDto` - 상세 응답

4. ✅ **컨트롤러에서 타입 명시 잘 됨**
   - `@ApiResponse`로 응답 타입 명시
   - HTTP 상태 코드별로 응답 타입 정의

---

## 개선 우선순위

### Priority 1: 즉시 수정 권장 (Critical)

**영향도: High | 난이도: Medium**

1. **날짜 필드 타입 통일**
   - 📍 위치: Products 도메인 (apps/pim/src/core/products/dto/)
   - 🎯 목표: 모든 날짜 필드를 `string` (ISO 8601) 타입으로 통일
   - 📝 작업: `ProductDto`, `ProductMasterDto`, `MasterListItemDto` 수정
   - ⏱️ 예상 시간: 2-3시간

2. **createdAt/updatedAt nullable 정책 통일**
   - 📍 위치: 전체 도메인
   - 🎯 목표: 생성/수정 시각은 NOT NULL로 통일
   - 📝 작업: 모든 Response DTO의 타임스탬프 필드 수정
   - ⏱️ 예상 시간: 1-2시간

**예상 효과:**
- 타입 안정성 크게 향상
- 프론트엔드 - 백엔드 간 타입 불일치 오류 제거
- JSON 직렬화/역직렬화 표준화

---

### Priority 2: 단기 개선 (Important)

**영향도: Medium | 난이도: Low**

3. **List Response DTO 필드명 통일**
   - 📍 위치: apps/pim/src/core/channels/dto/channel-listings/
   - 🎯 목표: `items` → `data`로 변경
   - 📝 작업: `ChannelListingListResponseDto` 수정
   - ⏱️ 예상 시간: 30분

4. **isActive nullable 정책 통일**
   - 📍 위치: 전체 도메인
   - 🎯 목표: `boolean | null` → `boolean`으로 통일 (기본값 설정)
   - 📝 작업: `ChannelProductDto` 등 수정
   - ⏱️ 예상 시간: 1시간

5. **페이지네이션 필드 순서 통일**
   - 📍 위치: 전체 List Response DTO
   - 🎯 목표: `{ data, total, page, limit }` 순서로 통일
   - 📝 작업: 필드 순서만 변경 (breaking change 없음)
   - ⏱️ 예상 시간: 30분

**예상 효과:**
- 일관된 API 응답 구조
- 프론트엔드 코드의 재사용성 향상
- 개발자 경험 개선

---

### Priority 3: 중기 리팩토링 (Nice to Have)

**영향도: Medium | 난이도: High**

6. **중복 DTO 정리**
   - 📍 위치: apps/pim/src/core/products/dto/
   - 🎯 목표: Product/Master/Version 관계 명확화
   - 📝 작업:
     - 공통 베이스 타입 추출
     - Summary/Detail DTO 분리
     - Variant DTO 통합
   - ⏱️ 예상 시간: 4-6시간

7. **JSONB any 타입 구체화**
   - 📍 위치: 전체 도메인
   - 🎯 목표: `any` → 구조화된 인터페이스 또는 `Record<string, unknown>`
   - 📝 작업:
     - `ProductImages` 인터페이스 정의
     - `ChannelConfig` 인터페이스 정의
     - `ProductAttributes` 인터페이스 정의
   - ⏱️ 예상 시간: 3-4시간

8. **공통 베이스 타입 추출**
   - 📍 위치: apps/pim/src/common/dto/
   - 🎯 목표: 재사용 가능한 공통 타입 라이브러리 구축
   - 📝 작업:
     - `base.dto.ts` 생성 (BaseTimestamps, SoftDeletable 등)
     - `pagination.dto.ts` 생성 (PaginatedResponse 등)
   - ⏱️ 예상 시간: 2-3시간

**예상 효과:**
- 코드 중복 제거
- 타입 안정성 극대화
- 유지보수성 향상
- 새로운 기능 개발 속도 향상

---

## 구체적 액션 아이템

### Step 1: 타입 표준 가이드 문서 작성

**파일:** `apps/pim/docs/TYPE_STANDARDS.md`

**내용:**
```markdown
# PIM API 타입 표준 가이드

## 1. 날짜/시간 타입
- ✅ Response DTO: ISO 8601 문자열 (`string`)
- ✅ Entity/Model: JavaScript `Date` 객체
- ✅ 변환: 서비스 레이어에서 `.toISOString()` 사용

## 2. Nullable 규칙
- ✅ `createdAt`, `updatedAt`: NOT NULL
- ✅ `deletedAt`: NULLABLE (소프트 삭제용)
- ✅ `isActive`: NOT NULL (기본값 true)
- ✅ 비즈니스 필드: 요구사항에 따라 결정

## 3. List 응답 구조
- ✅ 필드명: `data` (items 사용 금지)
- ✅ 필드 순서: `{ data, total, page, limit }`

## 4. JSONB 필드
- ❌ `any` 사용 금지
- ✅ 구조화된 인터페이스 정의 권장
- ✅ 불가피한 경우 `Record<string, unknown>` 사용
```

---

### Step 2: 공통 타입 라이브러리 생성

**파일 구조:**

```
apps/pim/src/common/dto/
├── base.dto.ts           # 기본 타입들
├── pagination.dto.ts     # 페이지네이션
└── index.ts              # 통합 export
```

**base.dto.ts:**

```typescript
import { ApiProperty } from '@nestjs/swagger';

/**
 * 모든 엔티티의 기본 타임스탬프
 * 생성일시와 수정일시는 항상 존재합니다.
 */
export abstract class BaseTimestamps {
  @ApiProperty({
    description: '생성일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z'
  })
  createdAt: string;

  @ApiProperty({
    description: '수정일시 (ISO 8601 형식)',
    example: '2025-12-05T10:30:00.000Z'
  })
  updatedAt: string;
}

/**
 * 소프트 삭제를 지원하는 엔티티
 */
export abstract class SoftDeletable extends BaseTimestamps {
  @ApiProperty({
    description: '삭제일시 (ISO 8601 형식, 삭제되지 않은 경우 null)',
    example: '2025-12-05T10:30:00.000Z',
    nullable: true
  })
  deletedAt: string | null;
}

/**
 * 활성 상태를 가지는 엔티티
 */
export interface Activatable {
  /** 활성 상태 (기본값: true) */
  isActive: boolean;
}

/**
 * 설명 필드를 가지는 엔티티
 */
export interface Describable {
  /** 설명 (선택 사항) */
  description: string | null;
}

/**
 * 정렬 순서를 가지는 엔티티
 */
export interface Sortable {
  /** 정렬 순서 (숫자가 작을수록 앞에 표시) */
  sortOrder: number;
}
```

**pagination.dto.ts:**

```typescript
import { ApiProperty } from '@nestjs/swagger';

/**
 * 페이지네이션 응답 인터페이스
 *
 * @template T - 데이터 아이템 타입
 */
export interface PaginatedResponse<T> {
  /** 데이터 배열 */
  data: T[];

  /** 전체 아이템 수 */
  total: number;

  /** 현재 페이지 번호 (1부터 시작) */
  page: number;

  /** 페이지당 아이템 수 */
  limit: number;
}

/**
 * 페이지네이션 응답 기본 클래스
 *
 * 사용 예시:
 * ```typescript
 * export class MasterListResponseDto extends BasePaginatedResponse<MasterListItemDto> {
 *   @ApiProperty({ type: [MasterListItemDto] })
 *   data: MasterListItemDto[];
 * }
 * ```
 */
export abstract class BasePaginatedResponse<T> implements PaginatedResponse<T> {
  abstract data: T[];

  @ApiProperty({ description: '전체 아이템 수', minimum: 0 })
  total: number;

  @ApiProperty({ description: '현재 페이지 번호', minimum: 1 })
  page: number;

  @ApiProperty({ description: '페이지당 아이템 수', minimum: 1 })
  limit: number;
}

/**
 * 페이지네이션 요청 쿼리 파라미터
 */
export class PaginationQueryDto {
  @ApiProperty({
    description: '페이지 번호 (1부터 시작)',
    required: false,
    default: 1,
    minimum: 1
  })
  page?: number;

  @ApiProperty({
    description: '페이지당 아이템 수',
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100
  })
  limit?: number;
}
```

---

### Step 3: 점진적 마이그레이션 계획

#### Phase 1: 공통 타입 도입 (Week 1)

1. **공통 타입 라이브러리 생성**
   - `apps/pim/src/common/dto/` 디렉토리 생성
   - `base.dto.ts`, `pagination.dto.ts` 작성
   - 단위 테스트 작성

2. **타입 표준 문서 작성**
   - `TYPE_STANDARDS.md` 작성
   - 팀 리뷰 및 합의

#### Phase 2: 핵심 DTO 수정 (Week 2-3)

**우선순위 1 작업:**

1. **Products 도메인 날짜 타입 통일**
   ```typescript
   // Before (apps/pim/src/core/products/dto/products/product-response.dto.ts)
   createdAt: string;  // OK
   updatedAt: string;  // OK

   // Before (apps/pim/src/core/products/dto/masters/master-response.dto.ts)
   createdAt: Date | null;  // ❌
   updatedAt: Date | null;  // ❌

   // After
   createdAt: string;  // ✅
   updatedAt: string;  // ✅
   ```

2. **서비스 레이어 변환 로직 추가**
   ```typescript
   // apps/pim/src/core/products/services/product-masters.service.ts

   async getMasterDetail(masterId: string) {
     const master = await this.db.query.productMasters.findFirst({
       where: eq(productMasters.id, masterId)
     });

     // Date → string 변환
     return {
       ...master,
       createdAt: master.createdAt.toISOString(),
       updatedAt: master.updatedAt.toISOString(),
       deletedAt: master.deletedAt?.toISOString() ?? null,
     };
   }
   ```

3. **List Response DTO 표준화**
   ```typescript
   // Before (apps/pim/src/core/channels/dto/channel-listings/channel-listing-response.dto.ts:89)
   export class ChannelListingListResponseDto {
     items: ChannelListingWithChannelDto[];  // ❌
     total: number;
   }

   // After
   export class ChannelListingListResponseDto extends BasePaginatedResponse<ChannelListingWithChannelDto> {
     @ApiProperty({ type: [ChannelListingWithChannelDto] })
     data: ChannelListingWithChannelDto[];  // ✅
   }
   ```

#### Phase 3: 전체 도메인 적용 (Week 4-5)

**우선순위 2 작업:**

1. **Categories 도메인**
   - `CategoryResponseDto` 등에 `BasePaginatedResponse` 적용

2. **Channels 도메인**
   - 모든 List Response DTO 표준화

3. **Tags 도메인**
   - 날짜 타입 확인 및 표준화

4. **Pricing 도메인**
   - 날짜 타입 확인 및 표준화

#### Phase 4: 리팩토링 (Week 6-8)

**우선순위 3 작업:**

1. **중복 DTO 정리**
   - Product/Master/Version 관계 명확화
   - 공통 베이스 타입 추출

2. **JSONB 타입 구체화**
   - `ProductImages` 인터페이스 정의
   - `ChannelConfig` 인터페이스 정의

3. **문서화 업데이트**
   - Swagger 문서 확인
   - README 업데이트

---

### Step 4: 자동화 도구 활용

**ESLint 규칙 추가:**

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // any 타입 사용 금지
    '@typescript-eslint/no-explicit-any': 'error',

    // Date 타입 DTO에서 사용 금지 (Response DTO는 string 사용)
    '@typescript-eslint/ban-types': [
      'error',
      {
        types: {
          Date: {
            message: 'Response DTO에서는 ISO 8601 string을 사용하세요',
            fixWith: 'string'
          }
        },
        extendDefaults: true
      }
    ]
  }
};
```

**타입 체크 강화:**

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true
  }
}
```

---

## 참고 자료

### 분석 대상 파일 목록

**Controllers (8개):**
- `apps/pim/src/core/categories/categories.controller.ts`
- `apps/pim/src/core/products/controllers/product-masters.controller.ts`
- `apps/pim/src/core/products/controllers/product-variants.controller.ts`
- `apps/pim/src/core/products/controllers/product-versions.controller.ts`
- `apps/pim/src/core/channels/sales-channels.controller.ts`
- `apps/pim/src/core/channels/channel-products.controller.ts`
- `apps/pim/src/core/channels/channel-listing.controller.ts`
- `apps/pim/src/core/tags/tags.controller.ts`

**주요 Response DTO (27개):**
- Categories: 5개 (CategoryResponseDto, CategoryDetailResponseDto, CategoryTreeResponseDto 등)
- Products: 8개 (ProductDto, MasterListResponseDto, VariantListResponseDto 등)
- Channels: 7개 (SalesChannelDto, ChannelProductListResponseDto 등)
- Tags: 4개 (TagGroupResponseDto, TagValueResponseDto 등)
- Pricing: 3개 (PricingRuleResponseDto, CalculatePriceResponseDto 등)

### 관련 문서

- [NestJS Best Practices - DTOs](https://docs.nestjs.com/techniques/validation)
- [TypeScript Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)
- [JSON API Specification](https://jsonapi.org/format/)
- [ISO 8601 Date Format](https://www.iso.org/iso-8601-date-and-time-format.html)

---

## 변경 이력

| 일자 | 버전 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 2025-12-05 | 1.0.0 | 초안 작성 | Claude |

---

## 문의 및 피드백

이 문서에 대한 질문이나 제안 사항이 있으시면 팀 채널을 통해 공유해주세요.
