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
| 해외직구 | `isOverseas` |  | Y 또는 N. |
| 멤버십회원전용노출 | `isVisibleToMembersOnly` |  | Y 또는 N. |
| 비회원에게멤버십가숨김 | `hideMembershipPriceForNonMembers` |  | Y 또는 N. |
| 도매전용 | `isWholesaleOnly` |  | Y 또는 N. |
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
| **대표여부** | `isPrimary` | O | 상품마다 대표 카테고리 한 행에만 Y, 나머지 행은 N 또는 빈칸. |

## 구매제약

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| 멤버십필요 | `requiresMembership` |  | Y 또는 N. |
| 평생구매한도 | `lifetimeQuantityLimit` |  |  |

## 수량할인

| 열 | 내부 키 | 필수 | 설명 |
|---|---|---|---|
| **상품키** | `rowKey` | O |  |
| 조합 | `combination` |  | 비우면 기본 구간(예외로 고르지 않은 옵션 전부). 옵션마다 다르게 하려면 «조합» 시트의 조합 값을 그대로 붙여 넣는다. 조합 행의 구간 칸을 모두 비우면 그 옵션은 할인 없음. |
| 조합명(참고용) | `combinationLabel` |  | 읽지 않는다. 어느 옵션인지 보이려고 채워 둔다. |
| 사용 | `enabled` |  | Y 또는 N. 비우면 Y. 조합이 빈 행에만 넣는다. |
| 시작일 | `startsOn` |  | YYYY-MM-DD. 한국 시간 그날 0시부터. 비우면 바로 시작. 조합이 빈 행에만 넣는다. |
| 종료일 | `endsOn` |  | YYYY-MM-DD. 한국 시간 그날 끝까지. 비우면 계속. 조합이 빈 행에만 넣는다. |
| 구간1수량 | `tier1MinQuantity` |  | 2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다. |
| 구간1일반% | `tier1RegularRate` |  | 0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간1멤버십% | `tier1MembershipRate` |  | 0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간2수량 | `tier2MinQuantity` |  | 2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다. |
| 구간2일반% | `tier2RegularRate` |  | 0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간2멤버십% | `tier2MembershipRate` |  | 0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간3수량 | `tier3MinQuantity` |  | 2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다. |
| 구간3일반% | `tier3RegularRate` |  | 0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간3멤버십% | `tier3MembershipRate` |  | 0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간4수량 | `tier4MinQuantity` |  | 2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다. |
| 구간4일반% | `tier4RegularRate` |  | 0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간4멤버십% | `tier4MembershipRate` |  | 0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간5수량 | `tier5MinQuantity` |  | 2 이상 정수. 같은 옵션을 이 수량 이상 담으면 할인된다. 최대구매수량보다 크면 적용되지 않는다. |
| 구간5일반% | `tier5RegularRate` |  | 0~99 정수. 판매가 기준 할인율. 비우거나 0 이면 일반 고객은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |
| 구간5멤버십% | `tier5MembershipRate` |  | 0~99 정수. 멤버십가 기준 할인율. 비우거나 0 이면 멤버십 회원은 이 구간 할인 없음. 0 이 아니면 앞 구간보다 커야 한다. |

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
- `수량할인`
- `이미지`
- `카테고리 참조`
- `_양식정보`

## 상수

- 복합 가격규칙 센티넬: `[복합 가격규칙]`
