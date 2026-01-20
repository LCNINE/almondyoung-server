# Elasticsearch API 문서

## 개요

이 문서는 PIM 서버의 Elasticsearch 기반 상품 검색 API에 대한 상세한 설명을 제공합니다.

Elasticsearch는 PostgreSQL의 보완 검색 엔진으로 사용되며, 빠른 텍스트 검색, 필터링, 집계(aggregation) 기능을 제공합니다.

---

## 목차

1. [API 엔드포인트](#api-엔드포인트)
2. [요청 파라미터](#요청-파라미터)
3. [응답 구조](#응답-구조)
4. [검색 기능](#검색-기능)
5. [사용 예제](#사용-예제)
6. [에러 처리](#에러-처리)

---

## API 엔드포인트

### 상품 검색

```
GET /products/search
```

Elasticsearch를 사용하여 상품을 검색합니다. 키워드 검색, 필터링, 태그 필터링, 가격 범위 검색 등을 지원합니다.

**기능:**

- 키워드 기반 fuzzy 검색 (상품명, 설명, 상품코드)
- 카테고리 필터링
- 브랜드 필터링
- 가격 범위 필터링
- 태그 기반 필터링 (그룹 간 AND, 그룹 내 OR)
- 정렬 (관련도, 가격, 생성일)
- 페이지네이션
- 태그 집계 (aggregation)

---

## 요청 파라미터

모든 파라미터는 선택적(optional)입니다.

### Query Parameters

| 파라미터     | 타입           | 설명                                          | 기본값      |
| ------------ | -------------- | --------------------------------------------- | ----------- |
| `keyword`    | string         | 검색 키워드 (상품명, 설명, 상품코드에서 검색) | -           |
| `categoryId` | string         | 카테고리 ID로 필터링                          | -           |
| `brands`     | string[]       | 브랜드 이름 배열로 필터링 (OR 조건)           | -           |
| `minPrice`   | number         | 최소 가격                                     | -           |
| `maxPrice`   | number         | 최대 가격                                     | -           |
| `status`     | string         | 상품 상태로 필터링                            | -           |
| `tagFilters` | TagFilterDto[] | 태그 필터 배열 (그룹 간 AND, 그룹 내 OR)      | -           |
| `sortBy`     | enum           | 정렬 필드 (`relevance`, `price`, `createdAt`) | `relevance` |
| `sortOrder`  | enum           | 정렬 순서 (`asc`, `desc`)                     | `desc`      |
| `page`       | number         | 페이지 번호 (최소: 1)                         | `1`         |
| `limit`      | number         | 페이지당 아이템 수 (1-100)                    | `20`        |

### TagFilterDto 구조

태그 필터는 중첩된 구조로, 그룹 간에는 AND 조건, 그룹 내에서는 OR 조건으로 동작합니다.

```typescript
{
  groupId: string;      // 태그 그룹 ID
  valueIds: string[];   // 태그 값 ID 배열 (OR 조건)
}
```

**예시:**

- `tagFilters=[{groupId: "color", valueIds: ["red", "blue"]}, {groupId: "size", valueIds: ["L"]}]`
  - 의미: (색상이 red 또는 blue) **AND** (사이즈가 L)

---

## 응답 구조

### ProductSearchResponseDto

```typescript
{
  items: ProductSearchItemDto[];      // 검색 결과 상품 목록
  pagination: PaginationDto;           // 페이지네이션 정보
  aggregations?: SearchAggregationsDto; // 집계 정보 (태그 등)
}
```

### ProductSearchItemDto

```typescript
{
  master_id: string;           // Master ID
  product_id: string;          // Product ID (active version)
  version: number;             // Version 번호
  name: string;                // 상품명
  description: string | null;  // 상품 설명
  product_code: string | null; // 상품 코드
  brand: string | null;        // 브랜드
  status: string;              // 상품 상태
  approval_status: string | null; // 승인 상태
  price: number | null;        // 가격
  category_id: string | null; // 카테고리 ID
  category_name: string | null; // 카테고리 이름
  category_path: string | null; // 카테고리 경로
  tags: ProductTagDto[];       // 태그 목록
  created_at: string;          // 생성일 (ISO string)
  updated_at: string;          // 수정일 (ISO string)
  _score?: number;             // 검색 관련도 점수 (키워드 검색 시)
}
```

### ProductTagDto

```typescript
{
  group_id: string // 태그 그룹 ID
  group_name: string // 태그 그룹 이름
  value_id: string // 태그 값 ID
  value_name: string // 태그 값 이름
}
```

### PaginationDto

```typescript
{
  page: number // 현재 페이지
  limit: number // 페이지당 아이템 수
  total: number // 전체 아이템 수
  totalPages: number // 전체 페이지 수
}
```

### SearchAggregationsDto

```typescript
{
  tags?: TagGroupAggregationDto[]; // 태그 그룹별 집계
}
```

### TagGroupAggregationDto

```typescript
{
  group_id: string;              // 태그 그룹 ID
  group_name: string;            // 태그 그룹 이름
  values: TagValueAggregationDto[]; // 태그 값별 집계
}
```

### TagValueAggregationDto

```typescript
{
  value_id: string // 태그 값 ID
  value_name: string // 태그 값 이름
  count: number // 해당 태그를 가진 상품 수
}
```

---

## 검색 기능

### 1. 키워드 검색

`keyword` 파라미터를 사용하면 상품명(`name`), 설명(`description`), 상품코드(`product_code`)에서 검색합니다.

**특징:**

- **Fuzzy 검색**: 오타 허용 (`fuzziness: 'AUTO'`)
- **가중치**: 상품명(3배), 상품코드(2배), 설명(1배)
- **OR 연산자**: 여러 필드 중 하나라도 매칭되면 결과에 포함

**예시:**

```
GET /products/search?keyword=노트북
```

### 2. 필터링

#### 카테고리 필터

```
GET /products/search?categoryId=uuid-here
```

#### 브랜드 필터 (다중 선택 가능)

```
GET /products/search?brands=삼성&brands=LG
```

#### 가격 범위 필터

```
GET /products/search?minPrice=10000&maxPrice=50000
```

#### 상태 필터

```
GET /products/search?status=active
```

### 3. 태그 필터링

태그 필터는 중첩된 구조로, 그룹 간에는 AND, 그룹 내에서는 OR 조건으로 동작합니다.

**Elasticsearch nested query 사용:**

- `tags` 필드는 `nested` 타입으로 정의됨
- 각 태그 필터는 `nested` 쿼리로 변환됨

**예시:**

```
GET /products/search?tagFilters[0][groupId]=color&tagFilters[0][valueIds][]=red&tagFilters[0][valueIds][]=blue&tagFilters[1][groupId]=size&tagFilters[1][valueIds][]=L
```

의미: (색상이 red 또는 blue) **AND** (사이즈가 L)

### 4. 정렬

#### 관련도 정렬 (기본값)

- 키워드가 있는 경우: `_score` 내림차순
- 키워드가 없는 경우: `created_at` 내림차순

```
GET /products/search?sortBy=relevance&sortOrder=desc
```

#### 가격 정렬

```
GET /products/search?sortBy=price&sortOrder=asc
```

#### 생성일 정렬

```
GET /products/search?sortBy=createdAt&sortOrder=desc
```

### 5. 페이지네이션

```
GET /products/search?page=1&limit=20
```

- `page`: 페이지 번호 (최소: 1)
- `limit`: 페이지당 아이템 수 (1-100)

### 6. 집계 (Aggregation)

응답에 `aggregations` 필드가 포함되어, 검색 결과에 나타나는 태그들의 통계 정보를 제공합니다.

**구조:**

- 태그 그룹별로 집계
- 각 그룹 내 태그 값별 상품 수 제공

**용도:**

- 필터 UI에서 사용 가능한 태그 옵션 표시
- 각 태그 값의 상품 수 표시

---

## 사용 예제

### 예제 1: 기본 키워드 검색

**요청:**

```http
GET /products/search?keyword=노트북&page=1&limit=20
```

**응답:**

```json
{
  "items": [
    {
      "master_id": "uuid-1",
      "product_id": "uuid-2",
      "version": 1,
      "name": "삼성 노트북",
      "description": "고성능 노트북",
      "product_code": "NB-001",
      "brand": "삼성",
      "status": "active",
      "approval_status": "approved",
      "price": 1500000,
      "category_id": "cat-uuid",
      "category_name": "전자제품",
      "category_path": "전자제품 > 노트북",
      "tags": [
        {
          "group_id": "color",
          "group_name": "색상",
          "value_id": "red",
          "value_name": "빨강"
        }
      ],
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "_score": 2.5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  },
  "aggregations": {
    "tags": [
      {
        "group_id": "color",
        "group_name": "색상",
        "values": [
          {
            "value_id": "red",
            "value_name": "빨강",
            "count": 10
          },
          {
            "value_id": "blue",
            "value_name": "파랑",
            "count": 5
          }
        ]
      }
    ]
  }
}
```

### 예제 2: 복합 필터 검색

**요청:**

```http
GET /products/search?keyword=노트북&categoryId=cat-uuid&brands=삼성&brands=LG&minPrice=1000000&maxPrice=2000000&sortBy=price&sortOrder=asc&page=1&limit=20
```

**의미:**

- 키워드: "노트북"
- 카테고리: 특정 카테고리
- 브랜드: 삼성 또는 LG
- 가격: 1,000,000원 ~ 2,000,000원
- 정렬: 가격 오름차순

### 예제 3: 태그 필터 검색

**요청:**

```http
GET /products/search?tagFilters[0][groupId]=color&tagFilters[0][valueIds][]=red&tagFilters[0][valueIds][]=blue&tagFilters[1][groupId]=size&tagFilters[1][valueIds][]=L
```

**의미:**

- (색상이 red 또는 blue) **AND** (사이즈가 L)

### 예제 4: 전체 상품 조회 (필터 없음)

**요청:**

```http
GET /products/search?page=1&limit=20&sortBy=createdAt&sortOrder=desc
```

**의미:**

- 모든 상품을 생성일 내림차순으로 조회

---

## 에러 처리

### HTTP 상태 코드

| 상태 코드 | 설명                                   |
| --------- | -------------------------------------- |
| 200       | 성공                                   |
| 400       | 잘못된 요청 (유효성 검증 실패)         |
| 500       | 서버 오류 (Elasticsearch 연결 실패 등) |

### 에러 응답 형식

```json
{
  "statusCode": 500,
  "message": "Search failed: [에러 메시지]",
  "error": "Internal Server Error"
}
```

### 일반적인 에러 상황

1. **Elasticsearch 연결 실패**
   - 상태 코드: 500
   - 메시지: "Search failed: Connection refused" 등

2. **잘못된 파라미터**
   - 상태 코드: 400
   - 예: `limit`이 100을 초과하는 경우

3. **인덱스 없음**
   - 상태 코드: 500
   - 메시지: "Search failed: index_not_found_exception"

---

## 기술 세부사항

### Elasticsearch 인덱스

- **인덱스 이름**: `pim_products`
- **문서 타입**: 상품 문서 (비정규화된 구조)

### 검색 쿼리 구조

#### 키워드 검색 시

```json
{
  "multi_match": {
    "query": "키워드",
    "fields": ["name^3", "description", "product_code^2"],
    "fuzziness": "AUTO",
    "operator": "or"
  }
}
```

#### 태그 필터 시

```json
{
  "nested": {
    "path": "tags",
    "query": {
      "bool": {
        "must": [
          { "term": { "tags.group_id": "groupId" } },
          { "terms": { "tags.value_id": ["valueId1", "valueId2"] } }
        ]
      }
    }
  }
}
```

### 집계 구조

```json
{
  "tags_by_group": {
    "nested": { "path": "tags" },
    "aggs": {
      "groups": {
        "terms": { "field": "tags.group_id", "size": 50 },
        "aggs": {
          "group_name": {
            "top_hits": { "size": 1, "_source": ["tags.group_name"] }
          },
          "values": {
            "terms": { "field": "tags.value_id", "size": 100 },
            "aggs": {
              "value_name": {
                "top_hits": { "size": 1, "_source": ["tags.value_name"] }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 환경 설정

### 필수 환경 변수

```env
ELASTICSEARCH_NODE=https://your-elasticsearch-url:9200
ELASTICSEARCH_USERNAME=elastic  # 선택적
ELASTICSEARCH_PASSWORD=your-password  # 선택적
```

### 인덱스 초기화

인덱스가 없는 경우, 마이그레이션 스크립트를 실행하여 초기화할 수 있습니다:

```bash
npm run pim:migrate-es
```

---

## 참고 자료

- [Elasticsearch 공식 문서](https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html)
- [Nested Query 문서](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-nested-query.html)
- [Multi-match Query 문서](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-multi-match-query.html)

---

## 변경 이력

| 날짜       | 버전 | 변경 내용      |
| ---------- | ---- | -------------- |
| 2024-01-XX | 1.0  | 초기 문서 작성 |
