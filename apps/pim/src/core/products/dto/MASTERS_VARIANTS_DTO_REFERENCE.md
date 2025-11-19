# Masters & Variants DTO 타입 참조 문서

이 문서는 PIM 서비스의 제품 마스터(Masters), 변형(Variants), 버전(Versions) 관련 모든 DTO 타입을 정리한 참조 문서입니다.

---

## 📋 목차

1. [Masters DTO](#masters-dto)
   - [CreateMasterDto](#createmasterdto)
   - [UpdateProductMasterDto](#updateproductmasterdto)
   - [ProductMasterDto](#productmasterdto)
   - [MasterDetailDto](#masterdetaildto)
   - [MasterListItemDto](#masterlistitemdto)
   - [MasterListResponseDto](#masterlistresponsedto)
   - [MasterUpdateResponseDto](#masterupdateresponsedto)
   - [OptionDiffDto](#optiondiffdto)

2. [Variants DTO](#variants-dto)
   - [ProductVariantDto](#productvariantdto)
   - [VariantWithPriceDto](#variantwithpricedto)
   - [UpdateProductVariantDto](#updateproductvariantdto)
   - [UpdateVariantBulkDto](#updatevariantbulkdto)
   - [VariantListResponseDto](#variantlistresponsedto)
   - [VariantUpdateResponseDto](#variantupdateresponsedto)
   - [VariantPriceResponseDto](#variantpriceresponsedto)

3. [Versions DTO](#versions-dto)
   - [CreateDraftVersionDto](#createdraftversiondto)
   - [PublishVersionDto](#publishversiondto)
   - [VersionTreeResponseDto](#versiontreeresponsedto)
   - [VersionDiffItemDto](#versiondiffitemdto)

4. [공통 DTO](#공통-dto)
   - [ProductQueryDto](#productquerydto)

---

## Masters DTO

### CreateMasterDto

제품 마스터 생성을 위한 DTO. 모든 필드는 선택사항이며, 빈 draft 상태로 생성 후 update API로 정보를 채웁니다.

**Zod Schema: `CreateMasterSchema`**

```typescript
{
  name?: string;                    // 제품명 (미입력 시 "새 상품")
  description?: string;              // 제품 설명
  brand?: string;                    // 브랜드명
  thumbnail?: string;                // 썸네일 이미지 URL
  thumbnailUploadId?: string;         // 썸네일 이미지 업로드 ID (UUID)
  thumbnailUrl?: string;             // 썸네일 이미지 외부 URL
  additionalImageUploadIds?: string[]; // 부가 이미지 업로드 ID 배열 (최대 5개)
  tags?: string[];                   // 마케팅 태그
  images?: string[];                 // 제품 이미지 URL 배열
  attributes?: Record<string, any>;  // 제품 속성 (키-값 쌍)
  seoTitle?: string;                 // SEO 제목
  seoDescription?: string;           // SEO 설명
  seoKeywords?: string[];            // SEO 키워드
  descriptionHtml?: string;          // 상품 상세설명 HTML
  isWholesaleOnly?: boolean;         // 도매회원 전용 여부
  isMembershipOnly?: boolean;        // 멤버십회원 전용 여부
  categoryIds?: string[];            // 카테고리 ID 배열 (UUID)
  primaryCategoryId?: string;         // 주 카테고리 ID (categoryIds 중 하나여야 함)
}
```

**참고사항:**

- `basePrice` 필드는 제거되었습니다. 가격은 전적으로 pricing rules API로 설정합니다.
- `optionGroups` 필드는 제거되었습니다. 옵션은 `PUT /masters/:id` API의 `optionDiff` 필드를 사용합니다.

---

### UpdateProductMasterDto

제품 마스터 수정을 위한 DTO. draft 상태의 버전만 수정 가능합니다.

```typescript
{
  name?: string;                     // 제품 마스터 이름 (최소 1자)
  description?: string;              // 제품 설명
  brand?: string;                    // 브랜드명
  status?: 'active' | 'inactive' | 'draft'; // 제품 상태
  categoryIds?: string[];            // 카테고리 ID 배열 (기존 카테고리를 모두 대체)
  primaryCategoryId?: string;        // 주 카테고리 ID (UUID)

  // 이미지 관련
  thumbnail?: string;               // 썸네일 URL
  thumbnailUploadId?: string;        // 썸네일 업로드 ID (UUID)
  thumbnailUrl?: string;             // 썸네일 외부 URL
  additionalImageUploadIds?: string[]; // 부가 이미지 업로드 ID 배열 (최대 5개)
  images?: string[];                 // 제품 이미지 URL 배열

  // 마케팅/SEO
  tags?: string[];                   // 마케팅 태그
  seoTitle?: string;                // SEO 제목
  seoDescription?: string;          // SEO 설명
  seoKeywords?: string[];           // SEO 키워드
  descriptionHtml?: string;          // 상품 상세설명 HTML

  // 구매 제한
  isWholesaleOnly?: boolean;         // 도매회원 전용 여부
  isMembershipOnly?: boolean;        // 멤버십회원 전용 여부

  // 옵션 변경
  optionDiff?: OptionDiffDto;        // 옵션 변경사항
}
```

---

### ProductMasterDto

제품 마스터 기본 응답 DTO.

```typescript
{
  id: string;                         // 제품 마스터 ID (UUID 형식)
  name: string;                      // 제품 마스터 이름
  description: string | null;        // 제품 설명
  brand: string | null;              // 브랜드명
  tags: string[] | null;            // 마케팅 태그
  images: any;                       // 제품 이미지 (JSONB)
  attributes: any;                   // 제품 속성 (JSONB)
  seoTitle: string | null;           // SEO 제목
  seoDescription: string | null;    // SEO 설명
  seoKeywords: string[] | null;     // SEO 키워드
  status: string | null;              // 제품 상태
  isWholesaleOnly: boolean | null;   // 도매회원 전용 여부
  isMembershipOnly: boolean | null;  // 멤버십회원 전용 여부
  createdAt: Date | null;           // 생성일시
  updatedAt: Date | null;           // 수정일시
  createdBy: string | null;          // 생성자
  updatedBy: string | null;         // 수정자
}
```

**참고사항:**

- `basePrice` 필드는 제거되었습니다. 가격은 pricing rules로 조회합니다.

---

### MasterDetailDto

제품 마스터 상세 정보 응답 DTO. `ProductMasterDto`를 확장하며 옵션 그룹, 변형, 채널 제품 정보를 포함합니다.

```typescript
// ProductMasterDto의 모든 필드 상속
{
  optionGroups: OptionGroupDto[];    // 옵션 그룹들
  variants: VariantDto[];           // 연결된 제품 변형 목록
  channelProducts: ChannelProductDto[]; // 채널별 제품들
}
```

#### OptionGroupDto

```typescript
{
  id: string;                        // 옵션 그룹 ID
  name: string;                      // 옵션 그룹명
  displayName: string;                // 옵션 그룹 표시명
  sortOrder: number;                  // 정렬 순서
  isRequired: boolean;                // 필수 여부
  createdAt: Date;                    // 생성일시
  updatedAt: Date;                   // 수정일시
  values: OptionValueDto[];          // 옵션 값들
}
```

#### OptionValueDto

```typescript
{
  id: string; // 옵션 값 ID
  value: string; // 옵션 값
  displayName: string; // 옵션 값 표시명
  sortOrder: number; // 정렬 순서
  isActive: boolean; // 활성 여부
  createdAt: Date; // 생성일시
  updatedAt: Date; // 수정일시
}
```

#### VariantDto

```typescript
{
  id: string;                        // 변형 ID
  masterId: string;                  // 마스터 ID
  variantName: string | null;        // 변형명
  images: any;                       // 변형 이미지
  priceAdjustment: number | null;    // 가격 조정
  displayOrder: number | null;       // 표시 순서
  status: string | null;             // 변형 상태
  isDefault: boolean | null;         // 기본 변형 여부
  createdAt: Date | null;            // 생성일시
  updatedAt: Date | null;           // 수정일시
  optionValues: any[];               // 옵션 값들
  price?: number;                    // 계산된 가격 (선택)
}
```

#### ChannelProductDto

```typescript
{
  id: string; // 채널 제품 ID
  masterId: string; // 마스터 ID
  channelId: string; // 채널 ID
  name: string | null; // 채널별 제품명
  isActive: boolean | null; // 활성 여부
  channelSpecificData: any; // 채널별 특화 데이터
  createdAt: Date | null; // 생성일시
  updatedAt: Date | null; // 수정일시
  channel: ChannelInfoDto; // 채널 정보
}
```

#### ChannelInfoDto

```typescript
{
  id: string; // 채널 ID
  type: string; // 채널 타입
  name: string; // 채널명
  isActive: boolean | null; // 활성 여부
  apiConfig: any; // API 설정
  supportedFeatures: any; // 지원 기능
  createdAt: Date | null; // 생성일시
  updatedAt: Date | null; // 수정일시
}
```

---

### MasterListItemDto

제품 마스터 목록 조회 응답의 개별 아이템 DTO.

```typescript
{
  id: string; // 제품 마스터 ID
  name: string; // 제품 마스터 이름
  thumbnail: string | null; // 썸네일 이미지 URL
  isMembershipOnly: boolean | null; // 멤버십회원 전용 여부
  status: string | null; // 제품 상태
  createdAt: string | null; // 생성일시 (ISO 문자열)
}
```

---

### MasterListResponseDto

제품 마스터 목록 조회 응답 DTO.

```typescript
{
  data: MasterListItemDto[];        // 제품 마스터 목록
  page: number;                      // 현재 페이지 번호 (최소 1)
  limit: number;                    // 페이지당 아이템 수 (최소 1)
  total: number;                    // 전체 아이템 수 (최소 0)
}
```

---

### MasterUpdateResponseDto

제품 마스터 수정 응답 DTO.

```typescript
{
  success: boolean; // 수정 성공 여부
  data: ProductMasterDto; // 수정된 제품 마스터 정보
}
```

---

### OptionDiffDto

옵션 변경사항을 표현하는 DTO. 옵션 그룹 추가/수정/삭제 및 옵션 값 추가/삭제를 지원합니다.

```typescript
{
  add?: AddOptionDto[];              // 새로 추가할 옵션 그룹
  modifyDisplay?: ModifyOptionDisplayDto[]; // 기존 옵션 그룹의 표시 정보 수정
  addValues?: AddOptionValuesDto[];  // 기존 옵션 그룹에 새 값 추가
  removeValues?: RemoveOptionValuesDto[]; // 기존 옵션 그룹에서 값 제거
  remove?: string[];                 // 제거할 옵션 그룹 ID 목록 (UUID)
}
```

#### AddOptionDto

```typescript
{
  displayName: string;               // 옵션 그룹 표시명
  description?: string;               // 옵션 그룹 설명
  sortOrder?: number;                // 정렬 순서
  values: AddOptionValueDto[];       // 옵션 값 목록
}
```

#### AddOptionValueDto

```typescript
{
  displayName: string;               // 표시명
  colorCode?: string;                // 색상 코드 (예: #FF0000)
  imageUrl?: string;                 // 이미지 URL
  sortOrder?: number;                // 정렬 순서
}
```

#### ModifyOptionDisplayDto

```typescript
{
  optionGroupId: string;             // 옵션 그룹 ID (UUID)
  displayName?: string;               // 표시명
  description?: string;               // 설명
  sortOrder?: number;                // 정렬 순서
  values?: ModifyOptionValueDisplayDto[]; // 옵션 값 표시 정보 수정
}
```

#### ModifyOptionValueDisplayDto

```typescript
{
  optionValueId: string;             // 옵션 값 ID (UUID)
  displayName?: string;              // 표시명
  colorCode?: string;                // 색상 코드
  imageUrl?: string;                 // 이미지 URL
  sortOrder?: number;                // 정렬 순서
}
```

#### AddOptionValuesDto

```typescript
{
  optionGroupId: string;             // 옵션 그룹 ID (UUID)
  values: AddOptionValueDto[];        // 추가할 옵션 값 목록
}
```

#### RemoveOptionValuesDto

```typescript
{
  optionGroupId: string;             // 옵션 그룹 ID (UUID)
  optionValueIds: string[];          // 삭제할 옵션 값 ID 목록 (UUID 배열)
}
```

---

## Variants DTO

### ProductVariantDto

제품 변형 기본 DTO.

```typescript
{
  id: string; // 제품 변형 ID (UUID 형식)
  masterId: string; // 제품 마스터 ID (UUID 형식)
  variantName: string | null; // 변형명
  images: any; // 변형 이미지 (JSONB)
  priceAdjustment: number | null; // 가격 조정
  displayOrder: number | null; // 표시 순서
  status: string | null; // 변형 상태
  isDefault: boolean | null; // 기본 변형 여부
  createdAt: Date | null; // 생성일시
  updatedAt: Date | null; // 수정일시
}
```

---

### VariantWithPriceDto

가격 정보를 포함한 제품 변형 DTO. `ProductVariantDto`를 확장합니다.

```typescript
// ProductVariantDto의 모든 필드 상속
{
  price: number;                     // 계산된 가격
  optionValues: any[];               // 옵션 값들
}
```

---

### UpdateProductVariantDto

제품 변형 수정을 위한 DTO.

```typescript
{
  name?: string;                     // 제품 변형 이름 (최소 1자)
  sku?: string;                      // SKU 코드
  attributes?: Record<string, any>;   // 변형 속성 (색상, 사이즈 등)
  images?: string[];                 // 변형별 이미지 URL 배열
  status?: 'active' | 'inactive';    // 변형 상태
  weight?: number;                   // 무게 (g, 최소 0)
  dimensions?: DimensionsDto;        // 치수 정보
}
```

#### DimensionsDto

```typescript
{
  length: number; // 길이 (cm, 최소 0)
  width: number; // 너비 (cm, 최소 0)
  height: number; // 높이 (cm, 최소 0)
}
```

---

### UpdateVariantBulkDto

여러 제품 변형을 일괄 수정하기 위한 DTO.

```typescript
{
  variantIds: string[];              // 변형 ID 목록 (최소 1개)
  updates: BulkUpdatesDto;           // 수정할 정보
}
```

#### BulkUpdatesDto

```typescript
{
  status?: string;                   // 상태
  displayOrder?: number;             // 표시 순서
  images?: string[];                 // 이미지 목록
}
```

---

### VariantListResponseDto

제품 변형 목록 조회 응답 DTO.

```typescript
{
  data: VariantWithPriceDto[];       // 제품 변형 목록
  total: number;                     // 전체 아이템 수 (최소 0)
  page: number;                      // 현재 페이지 번호 (최소 1)
  limit: number;                     // 페이지당 아이템 수 (최소 1)
}
```

---

### VariantUpdateResponseDto

제품 변형 수정 응답 DTO.

```typescript
{
  success: boolean; // 수정 성공 여부
  data: VariantWithPriceDto; // 수정된 제품 변형 정보
}
```

---

### VariantPriceResponseDto

제품 변형 가격 응답 DTO.

```typescript
{
  variantId: string; // 제품 변형 ID
  price: number; // 계산된 가격
}
```

---

### UpdateVariantStatusDto

제품 변형 상태만 수정하기 위한 DTO.

```typescript
{
  status: 'active' | 'inactive'; // 새로운 변형 상태
}
```

---

## Versions DTO

### CreateDraftVersionDto

새로운 draft 버전 생성을 위한 DTO. 기존 버전을 기반으로 새로운 draft 버전을 생성합니다.

```typescript
{
  parentVersionId: string;            // 부모 버전 ID (UUID)
  copyMappings?: boolean;             // 매핑 정보 복사 여부 (옵션, 품목, 가격정책)
                                      // 기본값: true
}
```

**사용 예시:**

- 기존 active 버전을 기반으로 새로운 draft 버전을 생성할 때 사용합니다.
- `copyMappings`가 `true`이면 옵션 그룹, variants, 가격 정책 등이 부모 버전에서 복사됩니다.
- `copyMappings`가 `false`이면 빈 draft 버전이 생성됩니다.

---

### PublishVersionDto

버전을 활성화하거나 비활성화하기 위한 DTO.

```typescript
{
  targetStatus: 'active' | 'inactive'; // 버전 상태
}
```

**사용 예시:**

- draft 버전을 `active`로 변경하여 활성화할 때 사용합니다.
- 기존 active 버전은 자동으로 `inactive`로 변경됩니다.
- `inactive`로 변경하면 버전이 비활성화됩니다.

**참고사항:**

- 한 번에 하나의 버전만 `active` 상태일 수 있습니다.
- 버전을 `active`로 변경하면 기존 active 버전은 자동으로 `inactive`로 변경됩니다.

---

### VersionTreeResponseDto

버전 트리 구조를 표현하는 응답 DTO. 부모-자식 관계를 포함한 버전 계층 구조를 나타냅니다.

```typescript
{
  id: string;                         // 버전 ID (UUID)
  masterId: string;                   // Master ID (논리적 그룹 ID)
  version: number;                    // 버전 번호
  versionStatus: 'draft' | 'inactive' | 'active'; // 버전 상태
  name: string;                       // 상품명
  parentVersionId: string | null;     // 부모 버전 ID (최상위 버전은 null)
  children: VersionTreeResponseDto[];  // 자식 버전들 (재귀 구조)
  createdAt: string;                  // 생성일시 (ISO 문자열)
  updatedAt: string;                  // 수정일시 (ISO 문자열)
  draftOwnerId?: string | null;      // Draft 소유자 ID (draft 상태일 때만)
}
```

**트리 구조 예시:**

```
v1 (active)
  └─ v2 (draft)
      └─ v3 (draft)
v4 (inactive)
```

**참고사항:**

- `children` 배열은 재귀적으로 중첩된 버전 구조를 표현합니다.
- `parentVersionId`가 `null`이면 최상위 버전입니다.
- `draftOwnerId`는 draft 버전을 소유한 사용자 ID입니다.

---

### VersionDiffItemDto

버전 간 차이점을 표현하는 DTO. 두 버전 간 변경된 필드와 값을 나타냅니다.

```typescript
{
  field: string; // 필드명
  oldValue: any; // 이전 값
  newValue: any; // 새 값
}
```

**사용 예시:**

- 두 버전 간의 차이점을 비교할 때 사용합니다.
- `field`는 변경된 필드명 (예: `name`, `description`, `status` 등)
- `oldValue`는 이전 버전의 값
- `newValue`는 새 버전의 값

**예시:**

```typescript
{
  field: "name",
  oldValue: "이전 상품명",
  newValue: "새 상품명"
}
```

---

## 공통 DTO

### ProductQueryDto

제품 조회를 위한 쿼리 파라미터 DTO.

```typescript
{
  keyword?: string;                  // 검색 키워드
  categoryIds?: string[];           // 카테고리 ID 배열
  approvalStatus?: string;          // 승인 상태: 'draft' | 'pending' | 'approved' | 'rejected'
  status?: string;                  // 상태: 'active' | 'inactive'
  productType?: string;             // 제품 타입: 'limited_edition' | 'regular_sale'
  brand?: string;                   // 브랜드
  seller?: string;                  // 판매자
  startDate?: string;               // 시작일 (ISO 날짜 문자열)
  endDate?: string;                 // 종료일 (ISO 날짜 문자열)
  dateRange?: string;               // 날짜 범위: 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  sortBy?: string;                  // 정렬 기준: 'createdAt' | 'updatedAt' | 'name'
  sortOrder?: 'asc' | 'desc';       // 정렬 순서
  page?: number;                    // 페이지 번호 (기본값: 1, 최소 1)
  limit?: number;                   // 페이지당 아이템 수 (기본값: 20, 최소 1)
  includeDeleted?: boolean;         // 삭제된 항목 포함 여부 (기본값: false)
}
```

---

## 📝 참고사항

### 가격 관리

- `basePrice` 필드는 모든 DTO에서 제거되었습니다.
- 가격은 전적으로 **Pricing Rules API**를 통해 관리됩니다.
- 가격 조회는 `GET /products/:masterId/pricing-rules` 또는 `POST /products/:masterId/pricing/calculate`를 사용합니다.

### 옵션 관리

- 옵션 그룹은 `CreateMasterDto`에서 직접 생성할 수 없습니다.
- 옵션은 `PUT /masters/:id` API의 `optionDiff` 필드를 통해 관리합니다.
- 옵션 구조 변경 시 variants가 자동으로 재생성됩니다.

### 버전 관리

- 제품 마스터는 버전 관리 시스템을 사용합니다.
- `id`는 물리적 버전 ID이고, `masterId`는 논리적 그룹 ID입니다.
- draft 상태의 버전만 수정 가능합니다.

### 이미지 관리

- 썸네일은 `thumbnailUrl` (외부 URL) 또는 `thumbnailUploadId` (업로드 ID)로 설정할 수 있습니다.
- 부가 이미지는 `additionalImageUploadIds` 배열로 관리하며, 최대 5개까지 가능합니다.

---

**문서 생성일:** 2024년
**마지막 업데이트:** 2024년
