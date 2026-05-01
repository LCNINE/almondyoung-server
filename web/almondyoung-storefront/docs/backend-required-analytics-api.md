# 백엔드 Analytics API 필요 사항

**작성일**: 2025-12-17  
**목적**: 베스트 페이지(`/best`) 구현을 위한 Analytics API 스펙 요청

---

## 📌 현재 상황

**문제점**:

- 베스트 페이지가 하드코딩된 더미 데이터로 구성됨
- PIM API에는 판매량/인기도 기반 정렬 기능이 없음
- 현재 PIM API 정렬 옵션: `"relevance"` | `"price"` | `"createdAt"`만 지원

**필요한 기능**:

1. 판매량 기반 베스트 상품 조회
2. 인기 검색 키워드 랭킹
3. 인기 브랜드 랭킹

---

## 🎯 필요한 API 스펙

### 1. 베스트 상품 API

**엔드포인트**: `GET /analytics/best-products`

**Query Parameters**:

```typescript
{
  period?: "1d" | "7d" | "30d" | "90d";  // 집계 기간 (기본값: 7d)
  limit?: number;                         // 결과 개수 (기본값: 20, 최대: 100)
  categoryId?: string;                    // 카테고리별 베스트 (선택)
  page?: number;                          // 페이지네이션 (선택)
}
```

**Response**:

```json
{
  "data": [
    {
      "rank": 1,
      "masterId": "master-uuid",
      "versionId": "version-uuid",
      "name": "상품명",
      "thumbnail": "url",
      "brand": "브랜드",
      "salesCount": 1234,           // 판매 수량
      "salesAmount": 12340000,      // 판매 금액
      "viewCount": 5678,            // 조회수
      "trendType": "up" | "down" | "stable"  // 순위 변동
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "period": "7d"
}
```

**정렬 기준 (우선순위)**:

1. 판매량 (salesCount)
2. 판매 금액 (salesAmount)
3. 조회수 (viewCount)

**데이터 소스**:

- Order Service의 주문 데이터
- Analytics Service의 조회수 데이터 (있다면)
- 기간별 집계

---

### 2. 인기 검색 키워드 API

**엔드포인트**: `GET /analytics/trending-keywords`

**Query Parameters**:

```typescript
{
  period?: "1d" | "7d" | "30d" | "90d";  // 집계 기간 (기본값: 7d)
  limit?: number;                         // 결과 개수 (기본값: 10, 최대: 50)
}
```

**Response**:

```json
{
  "data": [
    {
      "rank": 1,
      "keyword": "롤리킹",
      "searchCount": 12345,         // 검색 횟수
      "categoryName": "속눈썹",     // 주요 카테고리 (검색 결과 기반)
      "trendType": "up" | "down" | "stable",
      "products": [                 // 해당 키워드의 상위 5개 상품
        {
          "masterId": "master-uuid",
          "name": "상품명",
          "thumbnail": "url",
          "basePrice": 50000
        }
      ]
    }
  ],
  "total": 100,
  "period": "7d"
}
```

**데이터 소스**:

- Search Service의 검색 로그
- Elasticsearch 검색 히스토리
- 기간별 집계

---

### 3. 인기 브랜드 API

**엔드포인트**: `GET /analytics/popular-brands`

**Query Parameters**:

```typescript
{
  period?: "1d" | "7d" | "30d" | "90d";  // 집계 기간 (기본값: 7d)
  limit?: number;                         // 결과 개수 (기본값: 10, 최대: 50)
}
```

**Response**:

```json
{
  "data": [
    {
      "rank": 1,
      "brandName": "브랜드명",
      "salesCount": 5678,           // 판매 수량
      "salesAmount": 56780000,      // 판매 금액
      "productCount": 123,          // 상품 수
      "trendType": "up" | "down" | "stable"
    }
  ],
  "total": 50,
  "period": "7d"
}
```

**데이터 소스**:

- Order Service의 주문 데이터 (브랜드별 집계)
- PIM Service의 브랜드 정보

---

## 📊 데이터 수집 및 집계 방식

### 1. 실시간 집계 vs 배치 집계

**권장: 배치 집계**

- **이유**:
  - 베스트 랭킹은 실시간 정확도가 중요하지 않음
  - 대용량 데이터 집계 시 성능 이슈 방지
  - 캐싱 전략과 결합하여 효율적 운영

**구현 방안**:

```
1. 배치 작업 (매시간 또는 매일)
   - Order Service에서 판매 데이터 집계
   - Search Service에서 검색 로그 집계
   - Analytics DB에 저장

2. API 응답
   - Analytics DB에서 조회 (빠른 응답)
   - Redis 캐싱 (TTL: 1시간)
```

### 2. 순위 변동 추적 (trendType)

**계산 방식**:

```typescript
// 이전 기간과 비교
const previousRank = getPreviousRank(productId, period)
const currentRank = getCurrentRank(productId, period)

if (currentRank < previousRank) {
  trendType = "up" // 순위 상승
} else if (currentRank > previousRank) {
  trendType = "down" // 순위 하락
} else {
  trendType = "stable" // 순위 유지
}
```

---

## 🔄 프론트엔드 통합 계획

### 1. API 연동 순서

1. **1단계**: 베스트 상품 API (`/analytics/best-products`)
   - 가장 중요한 기능
   - 베스트 페이지 메인 컨텐츠

2. **2단계**: 인기 검색 키워드 API (`/analytics/trending-keywords`)
   - 사용자 참여도 높은 컨텐츠

3. **3단계**: 인기 브랜드 API (`/analytics/popular-brands`)
   - 추가 컨텐츠

### 2. Fallback 전략

API 연동 전 또는 데이터 부족 시:

```typescript
// 현재 구현 (임시)
const fallbackProducts = await getProductListService({
  page: 1,
  limit: 20,
  sort: "createdAt:desc", // 최신 상품으로 대체
})
```

---

## 📝 프론트엔드 구현 상태

**파일**: `src/app/[countryCode]/(main)/best/page.tsx`

**현재 상태**:

- ✅ 하드코딩 제거 완료
- ✅ TODO 주석 추가
- ✅ 임시로 최신 상품 표시 (createdAt:desc)
- ⏳ Analytics API 연동 대기 중

**TODO 주석 위치**:

```typescript
// TODO: 백엔드에 판매량/인기도 기반 베스트 상품 API 추가 필요
// TODO: 백엔드에 검색 키워드 랭킹 API 추가 필요
// TODO: 인기 브랜드 API 연동 필요
```

---

## 🚀 우선순위 및 일정

### High Priority

1. **베스트 상품 API** (`/analytics/best-products`)
   - 베스트 페이지의 핵심 기능
   - 사용자 참여도 높음

### Medium Priority

2. **인기 검색 키워드 API** (`/analytics/trending-keywords`)
   - 사용자 검색 행동 분석
   - SEO에도 도움

### Low Priority

3. **인기 브랜드 API** (`/analytics/popular-brands`)
   - 추가 컨텐츠
   - 나중에 구현 가능

---

## 📞 연락처

**프론트엔드 담당**:

- 베스트 페이지 구현 완료 (API 대기 중)
- Analytics API 연동 준비 완료

**백엔드 요청 사항**:

1. Analytics API 개발 일정 확인
2. API 스펙 검토 및 피드백
3. 개발 완료 후 Swagger 문서 제공

---

**참고 문서**:

- `src/app/[countryCode]/(main)/best/page.tsx` - 베스트 페이지 구현
- PIM Service API 명세서 - 현재 API 제약사항 확인
