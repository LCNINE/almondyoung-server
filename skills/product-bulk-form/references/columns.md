# 워크북 열 레퍼런스

> 이 파일은 `form-export.sheets.ts` 의 `ALL_COLUMN_SETS` 에서 생성된다. 직접 고치지 마라 —
> `npx ts-node scripts/generate-bulk-form-columns.ts` 로 다시 만든다.

**볼드가 필수 열이다.** 파서는 헤더 *이름*으로 열을 찾으므로 열 순서는 자유이고, 모르는 열은 무시한다.

## 상품

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| **상품명** | `name` | O |  |
| **판매가** | `basePrice` | O |  |
| 멤버십가 | `membershipPrice` |  |  |
| 상품코드 | `productCode` |  |  |
| 브랜드 | `brand` |  |  |
| 대표이미지키 | `thumbnailImageKey` |  |  |
| 부가이미지키 | `additionalImageKeys` |  |  |
| 상세설명 | `description` |  |  |
| 별칭 | `alternativeName` |  |  |
| 소재 | `material` |  |  |
| 시중가 | `marketPrice` |  |  |
| 공급가 | `supplyPrice` |  |  |
| 상품유형 | `productType` |  |  |
| 배송유형 | `fulfillmentKind` |  |  |
| 판매분류 | `salesClassification` |  |  |
| 구매분류 | `purchaseClassification` |  |  |
| 연령제한 | `ageRestriction` |  |  |
| 최소구매수량 | `minQuantity` |  |  |
| 최대구매수량 | `maxQuantity` |  |  |
| 판매처 | `seller` |  |  |
| 해외직구 | `isOverseas` |  |  |
| 멤버십회원전용노출 | `isVisibleToMembersOnly` |  |  |
| 비회원에게멤버십가숨김 | `hideMembershipPriceForNonMembers` |  |  |
| 도매전용 | `isWholesaleOnly` |  |  |
| SEO제목 | `seoTitle` |  |  |
| SEO설명 | `seoDescription` |  |  |
| SEO키워드 | `seoKeywords` |  |  |
| 판매시작 | `salesStartDate` |  |  |
| 판매종료 | `salesEndDate` |  |  |

## 옵션

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| **옵션키** | `optionKey` | O |  |
| **옵션명** | `optionName` | O |  |
| **옵션값키** | `optionValueKey` | O |  |
| **옵션값명** | `optionValueName` | O |  |
| 옵션정렬 | `optionSortOrder` |  |  |
| 색상코드 | `colorCode` |  |  |
| 값정렬 | `valueSortOrder` |  |  |

## 조합

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| **조합** | `combination` | O |  |
| 조합명(참고용) | `combinationLabel` |  |  |
| 판매가 | `basePrice` |  |  |
| 멤버십가 | `membershipPrice` |  |  |
| 품목코드 | `variantCode` |  |  |
| 판매상태재정의 | `availabilityOverride` |  | '품절' 또는 '출시예정'. 값이 찍혀 있던 칸을 비우면 해제된다. 원래 비어 있던 칸은 변경 없음. |
| 출시예정일 | `comingSoonDate` |  | YYYY-MM-DD. 같은 행의 판매상태재정의가 '출시예정'일 때만 쓸 수 있다. 표시 전용이며 판매를 열지 않는다. |
| 선판매 | `preStockSellable` |  | Y 또는 N. 비우면 변경 없음(해제가 아니다). |
| 항상판매 | `alwaysSellableZeroStock` |  | Y 또는 N. 비우면 변경 없음(해제가 아니다). |

## 카테고리

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| **카테고리경로** | `categoryPath` | O |  |
| **대표여부** | `isPrimary` | O |  |

## 구매제약

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| 멤버십필요 | `requiresMembership` |  |  |
| 평생구매한도 | `lifetimeQuantityLimit` |  |  |

## 이미지

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **이미지키** | `imageKey` | O |  |
| **원본** | `sourceValue` | O |  |

## 카테고리 참조

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **카테고리경로** | `categoryPath` | O |  |

## 시트 이름

- `상품`
- `옵션`
- `조합`
- `카테고리`
- `구매제약`
- `이미지`
- `카테고리 참조`
- `_양식정보`

## 상수

- 복합 가격규칙 센티넬: `[복합 가격규칙]`
