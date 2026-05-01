# 백엔드 수정 대기 중인 항목

**작성일**: 2025-12-17  
**목적**: 백엔드 수정 완료 후 프론트엔드에서 즉시 반영할 항목 정리

---

## 📌 대기 중인 백엔드 수정 사항

### 1. 이미지 URL 제공

**현재 상황**:

- PIM API 응답에서 이미지가 `fileId` (UUID)로 내려옴
- Next.js Image 컴포넌트는 URL이 필요하여 에러 발생

**임시 해결**:

```typescript
// src/lib/utils/transformers/product.transformer.ts
// fileId (UUID) 감지 시 placeholder로 대체
const isFileId = (str?: string | null): boolean => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    str
  )
}

const normalizeImageUrl = (url?: string | null): string => {
  if (isFileId(url)) {
    console.warn(
      `[normalizeImageUrl] fileId 감지됨. 백엔드 public URL 제공 대기 중.`
    )
    return "https://placehold.co/240x240?text=No+Image"
  }
  return url || "https://placehold.co/240x240?text=No+Image"
}
```

**백엔드 수정 내용 (동영님 답변)**:

> 1. 이미지를 private과 public 이미지로 나눠서, public 이미지는 별도의 signed url 호출 없이 고정된 url을 이미지의 src로 사용할 수 있도록 하겠습니다.

**프론트엔드 반영 작업**:

1. `normalizeImageUrl` 함수에서 fileId 감지 로직 제거
2. PIM API 응답의 `thumbnail`, `images` 필드가 public URL로 바로 사용 가능
3. console.warn 제거

**영향 범위**:

- `src/lib/utils/transformers/product.transformer.ts`
- 모든 상품 목록/상세 페이지

---

### 2. 가격 정보 (priceRange) 제공

**현재 상황**:

- `GET /pim/masters?mode=active` 목록 응답에 가격 정보 없음
- 모든 상품이 0원으로 표시됨

**임시 해결**:

```typescript
// src/components/products/product-card.tsx
{basePrice === 0 ? (
  <span className="text-base font-bold text-gray-700 md:text-[19px]">
    가격 문의
  </span>
) : (
  <ProductPrice displayPrice={displayPrice} ... />
)}
```

**백엔드 수정 내용 (동영님 답변)**:

> 2. 해당 필드는 원래 있었는데, 속도 문제의 원인으로 의심되어 잠시 제거했었습니다. 실제로 속도 문제는 즉시 컴파일되는 개발 빌드라서 그랬던 것으로 파악했으므로 필드는 복구시키겠습니다.

**기대 응답**:

```json
{
  "data": [
    {
      "masterId": "uuid",
      "versionId": "uuid",
      "name": "상품명",
      "thumbnail": "https://...", // ✅ public URL
      "priceRange": {
        // ✅ 복구 예정
        "min": 10000,
        "max": 50000
      },
      "isMembershipOnly": false,
      "status": "active",
      "createdAt": "2025-12-08T11:00:00Z",
      "optionGroupNames": ["색상", "사이즈"],
      "variantCount": 4
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

**프론트엔드 반영 작업**:

1. `ProductListItemDto` 타입에 `priceRange` 추가:

   ```typescript
   export interface ProductListItemDto {
     masterId: string
     versionId: string
     name: string
     thumbnail: string | null
     brand: string | null
     priceRange?: { min: number; max: number } // ✅ 추가
     isMembershipOnly: boolean
     status: "active" | "inactive"
     createdAt: string
     optionGroupNames: string[]
     variantCount: number
   }
   ```

2. `toProductCard` transformer에서 priceRange 사용:

   ```typescript
   export const toProductCard = (dto: ProductListItemDto): ProductCard => {
     return {
       id: dto.masterId,
       name: dto.name,
       brand: dto.brand,
       thumbnail: normalizeImageUrl(dto.thumbnail),
       basePrice: dto.priceRange?.min, // ✅ 최저가를 기본가로 표시
       membershipPrice: undefined, // TODO: 멤버십 가격도 필요?
       // ...
     }
   }
   ```

3. `product-card.tsx`에서 "가격 문의" fallback 제거

**영향 범위**:

- `src/lib/types/dto/pim.ts` - `ProductListItemDto` 타입
- `src/lib/utils/transformers/product.transformer.ts` - `toProductCard` 함수
- `src/components/products/product-card.tsx` - UI 렌더링

---

## 📋 반영 체크리스트

### 이미지 URL 제공 완료 시

- [ ] `src/lib/types/dto/pim.ts`에서 이미지 필드 타입 확인 (fileId → URL)
- [ ] `src/lib/utils/transformers/product.transformer.ts`
  - [ ] `isFileId` 함수 제거
  - [ ] `normalizeImageUrl`에서 fileId 감지 로직 제거
  - [ ] console.warn 제거
- [ ] 상품 목록 페이지 테스트 (이미지 정상 표시)
- [ ] 상품 상세 페이지 테스트 (썸네일, 상세 이미지 정상 표시)
- [ ] 옵션 값 이미지 테스트 (색상 옵션 등)

### 가격 정보 제공 완료 시

- [ ] `src/lib/types/dto/pim.ts`
  - [ ] `ProductListItemDto`에 `priceRange` 필드 추가
  - [ ] `membershipPriceRange` 필요 여부 확인
- [ ] `src/lib/utils/transformers/product.transformer.ts`
  - [ ] `toProductCard`에서 `priceRange.min`을 `basePrice`로 사용
  - [ ] `membershipPrice` 처리 로직 추가 (필요 시)
- [ ] `src/components/products/product-card.tsx`
  - [ ] "가격 문의" fallback 제거 또는 조건 변경
- [ ] 상품 목록 페이지 테스트 (가격 정상 표시)
- [ ] 카테고리 페이지 테스트 (가격 정상 표시)
- [ ] 검색 결과 페이지 테스트 (가격 정상 표시)

---

## 💡 참고 사항

### 멤버십 가격 처리

현재는 `membershipPrice`를 undefined로 처리하고 있습니다. 백엔드에서 멤버십 가격 범위도 제공하는지 확인 필요:

```json
{
  "priceRange": {
    "regular": { "min": 10000, "max": 50000 },
    "membership": { "min": 9000, "max": 45000 }
  }
}
```

또는

```json
{
  "priceRange": { "min": 10000, "max": 50000 },
  "membershipPriceRange": { "min": 9000, "max": 45000 }
}
```

### 가격 표시 전략

가격 범위가 있을 때 UI 표시 방식:

1. **단일 가격** (`min === max`):

   ```
   10,000원
   ```

2. **가격 범위** (`min !== max`):

   ```
   10,000원 ~ 50,000원
   ```

3. **최저가만 표시** (현재 방식):
   ```
   10,000원부터
   ```

---

## 📞 연락

**프론트엔드 준비 상태**:

- ✅ 임시 해결 완료 (fileId → placeholder, 가격 0원 → "가격 문의")
- ✅ 백엔드 수정 후 즉시 반영 가능한 구조

**백엔드 요청**:

- [ ] 이미지 public URL 제공
- [ ] 가격 범위 (priceRange) 복구

---

**관련 문서**:

- `docs/backend-check-pim-price.md` - 가격 문제 상세 설명
- `src/lib/utils/transformers/product.transformer.ts` - 이미지/가격 변환 로직
- `src/components/products/product-card.tsx` - UI 렌더링
