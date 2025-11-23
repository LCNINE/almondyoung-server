# PIM 검색 고도화 및 태그 시스템 설계 문서

**작성일**: 2025-11-23  
**버전**: 1.0  
**상태**: 설계 단계

---

## 📋 목차

1. [개요](#개요)
2. [배경 및 문제점](#배경-및-문제점)
3. [솔루션 개요](#솔루션-개요)
4. [태그 시스템 설계](#태그-시스템-설계)
5. [Elasticsearch 통합 설계](#elasticsearch-통합-설계)
6. [아키텍처](#아키텍처)
7. [데이터 모델](#데이터-모델)
8. [검색 쿼리 설계](#검색-쿼리-설계)
9. [구현 로드맵](#구현-로드맵)
10. [기술 스택 및 의사결정](#기술-스택-및-의사결정)
11. [리스크 및 고려사항](#리스크-및-고려사항)

---

## 개요

### 목적
PIM(Product Information Management) 시스템의 검색 기능을 고도화하고, 카테고리별 동적 필터링을 지원하는 태그 시스템을 도입하여 사용자 경험을 향상시킵니다.

### 핵심 기능
1. **의미론적 검색**: 임베딩 벡터 기반 유사도 검색
2. **Hybrid Search**: 키워드 검색 + 벡터 검색 융합
3. **오타 교정 및 동의어 처리**: 사용자 입력의 유연한 해석
4. **동적 태그 필터링**: 카테고리별 맞춤 필터 제공
5. **복잡한 조건 필터링**: 다중 조건 AND/OR 조합

### 비즈니스 가치
- 검색 정확도 향상 → 상품 발견율 증가
- 카테고리별 전문 필터 → 사용자 편의성 향상
- 빠른 응답 시간 → 사용자 이탈률 감소
- 확장 가능한 필터 시스템 → 신규 카테고리 대응 용이

---

## 배경 및 문제점

### 현재 시스템 (PostgreSQL LIKE 쿼리)

현재 PIM 검색은 `product-search.service.ts`에서 PostgreSQL의 `LIKE` 연산자를 사용합니다:

```typescript
// 현재 구조
like(productMasters.name, `%${query.keyword}%`)
like(productMasters.description, `%${query.keyword}%`)
```

### 문제점

#### 1. 성능 문제
- `LIKE '%keyword%'` 패턴은 인덱스 미활용 → **Full Table Scan**
- 데이터 증가 시 급격한 성능 저하 (현재 ~10,000건)
- 복잡한 필터 조합 시 응답 시간 증가

#### 2. 검색 기능 한계
- **오타 미지원**: "아이쑨" 검색 시 "아이폰" 찾지 못함
- **동의어 미지원**: "기가" vs "GB" 별도 처리 필요
- **관련도 정렬 불가**: 단순 문자열 매칭만 가능
- **형태소 분석 없음**: "아이폰으로" vs "아이폰" 다르게 인식

#### 3. 필터링 유연성 부족
- 카테고리별 특화 필터 구현 어려움
- 동적 필터 추가 시 스키마 변경 필요
- 속눈썹 가모: "컬 모양(C/J/D)", "두께(0.15T)", "길이(12mm)"
- 네일 파츠: "모양", "재질"
- → 각 카테고리마다 다른 필터 필요

---

## 솔루션 개요

### 핵심 전략: Hybrid Search + Dynamic Tagging

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│  ┌────────────────┐  ┌────────────────┐                │
│  │ Query          │  │ Tag System     │                │
│  │ Processing     │  │ (Dynamic       │                │
│  │ - Typo Fix     │  │  Faceted       │                │
│  │ - Synonym      │  │  Filtering)    │                │
│  │ - Embedding    │  │                │                │
│  └────────────────┘  └────────────────┘                │
└─────────────────────────────────────────────────────────┘
         ↓ Write               ↓ Search
┌──────────────────┐    ┌─────────────────────────────┐
│   PostgreSQL     │    │      Elasticsearch          │
│ (Source of Truth)│←───│  (Search Engine)            │
│                  │sync│                             │
│ - Products       │    │  - Inverted Index          │
│ - Categories     │    │  - Dense Vector (Embedding)│
│ - Tags (Groups/  │    │  - Fuzzy Search            │
│   Values)        │    │  - Synonym Support         │
│ - Relationships  │    │  - Aggregations            │
└──────────────────┘    └─────────────────────────────┘
```

### 주요 개선사항

| 항목 | 현재 (PostgreSQL) | 개선 후 (Elasticsearch) |
|------|-------------------|------------------------|
| 검색 속도 (10만건) | ~3초 | ~20ms |
| 오타 허용 | ❌ | ✅ Fuzzy Search |
| 동의어 처리 | ❌ | ✅ Synonym Filter |
| 의미 검색 | ❌ | ✅ Vector Search |
| 관련도 정렬 | ❌ | ✅ BM25 + Cosine |
| 동적 필터 | 제한적 | ✅ Tag System |
| 집계/통계 | 느림 | ✅ 빠른 Aggregation |

---

## 태그 시스템 설계

### 개념 모델

#### 태그 그룹 (Tag Group)
- 필터의 "범주"를 나타냄
- 예: "컬 모양", "컬 두께", "길이", "재질"

#### 태그 값 (Tag Value)
- 필터의 "선택 옵션"을 나타냄
- 예: "C컬", "0.15T", "12mm"
- 고유 ID로 관리 (이름이 같아도 다른 그룹이면 다른 값)

#### 관계
```
카테고리 ←─ M:N ─→ 태그 그룹 ←─ 1:N ─→ 태그 값
   ↓                                        ↑
   └───────────── M:N ──────────────────────┘
           (상품 ↔ 태그 값)
```

### 사용 시나리오

#### 시나리오 1: 속눈썹 연장 > 가모 카테고리

**관리자 설정**:
```
카테고리: "속눈썹 연장 > 가모"
  └─ 연결된 태그 그룹:
      ├─ "컬 모양" (순서: 1)
      │   ├─ C컬
      │   ├─ CC컬
      │   ├─ D컬
      │   └─ J컬
      ├─ "컬 두께" (순서: 2)
      │   ├─ 0.10T
      │   ├─ 0.15T
      │   └─ 0.20T
      └─ "길이" (순서: 3)
          ├─ 10mm
          ├─ 12mm
          └─ 14mm
```

**상품 등록**:
```
상품: "프리미엄 속눈썹 가모"
  └─ 할당된 태그 값:
      ├─ C컬 (컬 모양)
      ├─ J컬 (컬 모양)
      ├─ 0.15T (컬 두께)
      ├─ 12mm (길이)
      └─ 14mm (길이)
```

**프론트엔드 표시**:
```
[속눈썹 연장 > 가모] 카테고리 페이지
┌──────────────────────────────────┐
│ 검색: [________________] [검색]  │
├──────────────────────────────────┤
│ 📂 컬 모양                       │
│   ☐ C컬 (45)  ☐ CC컬 (32)       │
│   ☐ D컬 (28)  ☐ J컬 (38)        │
├──────────────────────────────────┤
│ 📂 컬 두께                       │
│   ☐ 0.10T (20) ☐ 0.15T (50)     │
│   ☐ 0.20T (35)                   │
├──────────────────────────────────┤
│ 📂 길이                          │
│   ☐ 10mm (30) ☐ 12mm (45)       │
│   ☐ 14mm (40)                    │
└──────────────────────────────────┘
```

#### 시나리오 2: 네일 > 파츠 카테고리

**관리자 설정**:
```
카테고리: "네일 > 파츠"
  └─ 연결된 태그 그룹:
      ├─ "파츠 모양"
      │   ├─ 하트
      │   ├─ 별
      │   └─ 꽃
      └─ "재질"
          ├─ 메탈
          ├─ 플라스틱
          └─ 크리스탈
```

### 태그 시스템의 장점

1. **유연성**: 카테고리별로 다른 필터 세트 제공
2. **확장성**: 새 태그 추가 시 스키마 변경 불필요
3. **재사용성**: 태그 그룹을 여러 카테고리에서 공유 가능
4. **동적 UI**: 프론트엔드에서 자동으로 필터 UI 생성

---

## 태그 그룹 상속 (Inheritance)

### 개념

카테고리 계층 구조에서 부모 카테고리에 연결된 태그 그룹을 자식 카테고리에서도 자동으로 사용할 수 있는 기능입니다.

### 핵심 필드: `applies_to_descendants`

카테고리-태그 그룹 연결 시 `applies_to_descendants` 플래그를 `true`로 설정하면, 해당 태그 그룹이 모든 하위 카테고리에도 적용됩니다.

```sql
-- 예시: 속눈썹 연장 카테고리에 "재질" 태그 그룹을 연결하고 하위 카테고리에도 적용
INSERT INTO category_tag_groups (category_id, tag_group_id, applies_to_descendants)
VALUES ('eyelash_extensions_id', 'material_tag_group_id', true);
```

### 상속 시나리오

#### 시나리오 1: 기본 상속

```
카테고리 A (속눈썹 연장)
  - 태그 그룹: "재질" (applies_to_descendants=true)
  └─ 카테고리 B (가모)
      - 태그 그룹: "컬 모양" (applies_to_descendants=false)
      └─ 카테고리 C (프리미엄 가모)

GET /categories/C/tag-groups
→ 반환:
  - "재질" (inherited from A)
  - "컬 모양" (inherited from B)
```

**동작**:
- 카테고리 C는 "재질"을 A로부터, "컬 모양"을 B로부터 상속
- 조상의 모든 `applies_to_descendants=true` 태그 그룹이 포함됨
- 각 태그 그룹에는 `isInherited`, `inheritedFromCategoryId`, `inheritedFromCategoryName` 정보 포함

#### 시나리오 2: 중복 방지

```
카테고리 A
  - 태그 그룹: "재질" (applies_to_descendants=true)
  └─ 카테고리 B

PUT /categories/B/tag-groups
Body: {
  links: [
    { tagGroupId: "material_tag_group_id", ... }  // 이미 A로부터 상속받음
  ]
}

→ 에러: "Tag group material_tag_group_id is already inherited from ancestor category A"
```

**동작**:
- 상속받은 태그 그룹을 직접 연결하려고 하면 에러 발생
- 데이터 정합성 보장 (중복 연결 방지)

#### 시나리오 3: 다단계 상속

```
카테고리 A (루트)
  - "재질" (applies_to_descendants=true)
  └─ 카테고리 B
      - "색상" (applies_to_descendants=true)
      - "크기" (applies_to_descendants=false)
      └─ 카테고리 C
          - "스타일" (applies_to_descendants=false)
          └─ 카테고리 D

GET /categories/D/tag-groups
→ 반환:
  - "재질" (inherited from A)
  - "색상" (inherited from B)
  - "스타일" (inherited from C)
```

**동작**:
- 모든 조상 카테고리로부터 `applies_to_descendants=true`인 태그 그룹 상속
- "크기"는 B에만 적용되고 C, D에는 적용되지 않음 (applies_to_descendants=false)

### 정렬 규칙

상속받은 태그 그룹과 직접 연결된 태그 그룹은 출처에 관계없이 `displayOrder`로 통합 정렬됩니다.

```
카테고리 B의 태그 그룹:
  - "재질" (inherited, displayOrder=5)
  - "컬 모양" (own, displayOrder=1)
  - "길이" (own, displayOrder=10)

정렬 후:
  1. "컬 모양" (displayOrder=1)
  2. "재질" (displayOrder=5)
  3. "길이" (displayOrder=10)
```

### API 응답 구조

```typescript
// GET /categories/{categoryId}/tag-groups
{
  "categoryId": "category_b_id",
  "categoryName": "가모",
  "tagGroups": [
    {
      "id": "material_group_id",
      "name": "재질",
      "displayOrder": 5,
      "isRequired": false,
      "appliesToDescendants": true,
      "isInherited": true,
      "inheritedFromCategoryId": "category_a_id",
      "inheritedFromCategoryName": "속눈썹 연장",
      "values": [...]
    },
    {
      "id": "curl_shape_group_id",
      "name": "컬 모양",
      "displayOrder": 1,
      "isRequired": true,
      "appliesToDescendants": false,
      "isInherited": false,
      "inheritedFromCategoryId": null,
      "inheritedFromCategoryName": null,
      "values": [...]
    }
  ]
}
```

### 구현 세부사항

#### 1. 조상 카테고리 조회 (재귀 CTE)

```typescript
private async _getAncestorCategoryIds(
  categoryId: string,
  tx: DbTransaction,
): Promise<Array<{ id: string; name: string; level: number }>> {
  const recursiveQuery = sql`
    WITH RECURSIVE ancestor_categories AS (
      SELECT id, name, parent_id, 0 as level
      FROM product_categories
      WHERE id = ${categoryId}
      
      UNION ALL
      
      SELECT pc.id, pc.name, pc.parent_id, ac.level + 1 as level
      FROM product_categories pc
      INNER JOIN ancestor_categories ac ON pc.id = ac.parent_id
    )
    SELECT id, name, level
    FROM ancestor_categories
    ORDER BY level ASC
  `;
  
  return await tx.execute(recursiveQuery);
}
```

#### 2. 상속 중복 검증

태그 그룹 연결 시 조상으로부터 이미 상속받은 태그 그룹인지 확인:

```typescript
// 조상들의 applies_to_descendants=true 태그 그룹 조회
const inheritedTagGroups = await tx
  .select()
  .from(categoryTagGroups)
  .where(
    and(
      inArray(categoryTagGroups.categoryId, ancestorIds),
      eq(categoryTagGroups.appliesToDescendants, true)
    )
  );

// 중복 체크
if (inheritedTagGroups.find(itg => itg.tagGroupId === newTagGroupId)) {
  throw new Error('Already inherited from ancestor');
}
```

#### 3. 상속 포함 조회

```typescript
// 자신 + 조상들의 태그 그룹 조회
const result = await tx
  .select()
  .from(categoryTagGroups)
  .where(
    and(
      inArray(categoryTagGroups.categoryId, allCategoryIds),
      or(
        eq(categoryTagGroups.categoryId, targetCategoryId),
        eq(categoryTagGroups.appliesToDescendants, true)
      )
    )
  );
```

### 사용 사례

#### 1. 대분류에 공통 필터 적용

```
네일 (대분류)
  - "재질" (applies_to_descendants=true)
  - "색상" (applies_to_descendants=true)
  ├─ 네일 팁
  │   └─ "팁 모양" (own)
  ├─ 네일 파츠
  │   └─ "파츠 모양" (own)
  └─ 네일 스티커
      └─ "스티커 크기" (own)
```

**효과**: "재질"과 "색상"은 모든 네일 하위 카테고리에 자동 적용

#### 2. 중분류별 전문 필터 추가

```
속눈썹 연장
  - "재질" (applies_to_descendants=true)
  ├─ 가모
  │   - "컬 모양" (applies_to_descendants=true)
  │   - "컬 두께" (applies_to_descendants=true)
  │   └─ 프리미엄 가모
  │       └─ "프리미엄 등급" (own)
  └─ 접착제
      └─ "접착력" (own)
```

**효과**: 
- 프리미엄 가모: "재질", "컬 모양", "컬 두께", "프리미엄 등급"
- 접착제: "재질", "접착력"

### 주의사항

1. **순환 참조 방지**: 카테고리 자체에 순환 참조가 없어야 함 (parent_id 관리)
2. **성능 고려**: 깊은 계층 구조에서는 재귀 쿼리 성능 모니터링 필요
3. **데이터 정합성**: 태그 그룹 변경 시 하위 카테고리에 미치는 영향 고려
4. **UI/UX**: 프론트엔드에서 상속받은 태그 그룹을 시각적으로 구분 표시 권장

---

## Elasticsearch 통합 설계

### 기능 매핑

#### Elasticsearch가 담당
- ✅ 모든 검색 쿼리 (텍스트 + 벡터)
- ✅ 필터링 (태그, 카테고리, 가격, 브랜드 등)
- ✅ 정렬 및 페이징
- ✅ 집계 (태그 옵션 + 상품 수 계산)
- ✅ 오타 교정 (Fuzzy Search)
- ✅ 동의어 처리 (Synonym Filter)

#### PostgreSQL이 담당
- ✅ 상품 생성/수정/삭제 (CRUD)
- ✅ 트랜잭션 보장
- ✅ 태그/카테고리 관리
- ✅ Source of Truth (정합성 보장)

### Elasticsearch 인덱스 매핑

```json
PUT /pim_products
{
  "settings": {
    "number_of_shards": 2,
    "number_of_replicas": 1,
    "analysis": {
      "tokenizer": {
        "nori_user_dict": {
          "type": "nori_tokenizer",
          "decompound_mode": "mixed",
          "user_dictionary_rules": [
            "아이폰",
            "갤럭시",
            "속눈썹",
            "가모"
          ]
        }
      },
      "filter": {
        "synonym_filter": {
          "type": "synonym",
          "synonyms": [
            "아이폰, iPhone, 아이쑨",
            "기가, GB, 기가바이트",
            "속눈썹, 속눈쎱, 숙녀썹",
            "가모, 래쉬, lash"
          ]
        },
        "edge_ngram_filter": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 10
        }
      },
      "analyzer": {
        "korean_analyzer": {
          "type": "custom",
          "tokenizer": "nori_user_dict",
          "filter": [
            "lowercase",
            "synonym_filter",
            "nori_readingform"
          ]
        },
        "autocomplete_analyzer": {
          "type": "custom",
          "tokenizer": "nori_user_dict",
          "filter": [
            "lowercase",
            "edge_ngram_filter"
          ]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "product_id": {
        "type": "keyword"
      },
      "name": {
        "type": "text",
        "analyzer": "korean_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          },
          "autocomplete": {
            "type": "text",
            "analyzer": "autocomplete_analyzer"
          }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "korean_analyzer"
      },
      "product_code": {
        "type": "keyword"
      },
      "brand": {
        "type": "keyword"
      },
      "status": {
        "type": "keyword"
      },
      "approval_status": {
        "type": "keyword"
      },
      "price": {
        "type": "long"
      },
      "stock_quantity": {
        "type": "integer"
      },
      "category_id": {
        "type": "keyword"
      },
      "category_name": {
        "type": "keyword"
      },
      "category_path": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "tags": {
        "type": "nested",
        "properties": {
          "group_id": {
            "type": "keyword"
          },
          "group_name": {
            "type": "keyword"
          },
          "value_id": {
            "type": "keyword"
          },
          "value_name": {
            "type": "keyword"
          }
        }
      },
      "tag_value_ids": {
        "type": "keyword"
      },
      "tag_group_ids": {
        "type": "keyword"
      },
      "name_embedding": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "cosine",
        "index_options": {
          "type": "hnsw",
          "m": 16,
          "ef_construction": 100
        }
      },
      "full_embedding": {
        "type": "dense_vector",
        "dims": 768,
        "index": true,
        "similarity": "cosine"
      },
      "created_at": {
        "type": "date"
      },
      "updated_at": {
        "type": "date"
      }
    }
  }
}
```

### 핵심 필드 설명

#### 1. 텍스트 검색 필드
- `name`: 상품명 (형태소 분석 + 동의어)
- `name.autocomplete`: 자동완성용 (Edge N-gram)
- `description`: 상세 설명

#### 2. 필터링 필드
- `category_id`, `brand`, `status`: 정확한 매칭용 (keyword)
- `price`, `stock_quantity`: 범위 검색용 (numeric)

#### 3. 태그 필드
- `tags` (nested): 그룹별 집계용 (상세 정보 포함)
- `tag_value_ids`: 빠른 필터링용 (플랫 배열)

#### 4. 벡터 검색 필드
- `name_embedding`: 상품명 임베딩 (의미 검색)
- `full_embedding`: 상품명+설명 임베딩 (전체 문맥 검색)

---

## 아키텍처

### CQRS 패턴 적용

```
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway / Client                    │
└─────────────────────────────────────────────────────────────┘
                        ↓                    ↓
              [Command: 쓰기]          [Query: 읽기/검색]
                        ↓                    ↓
┌──────────────────────────────┐  ┌─────────────────────────┐
│  ProductMasterService        │  │  ProductSearchService   │
│  - create()                  │  │  - search()             │
│  - update()                  │  │  - getFilters()         │
│  - delete()                  │  │  - autocomplete()       │
│                              │  │                         │
│  TagManagementService        │  │  (Elasticsearch only)   │
│  - createTag()               │  │                         │
│  - linkCategoryToTag()       │  │                         │
└──────────────────────────────┘  └─────────────────────────┘
         ↓                                    ↓
         ↓                                    ↓
┌──────────────────────────────┐  ┌─────────────────────────┐
│       PostgreSQL             │  │     Elasticsearch       │
│  ┌────────────────────────┐  │  │  ┌──────────────────┐  │
│  │ product_masters        │  │  │  │ products index   │  │
│  │ product_categories     │  │  │  │ (denormalized)   │  │
│  │ tag_groups            │  │  │  │                  │  │
│  │ tag_values            │  │  │  │ - All product    │  │
│  │ product_tag_values    │  │  │  │   fields         │  │
│  │ category_tag_groups   │  │  │  │ - Tags (nested)  │  │
│  └────────────────────────┘  │  │  │ - Embeddings     │  │
│                              │  │  └──────────────────┘  │
└──────────────────────────────┘  └─────────────────────────┘
         ↓                                    ↑
         └────────── Event-driven Sync ───────┘
                  (product.created,
                   product.updated,
                   product.deleted)
```

### 데이터 동기화 흐름

```typescript
// 1. 상품 생성 시
@Post('/')
async createProduct(dto: CreateProductDto) {
  // PostgreSQL에 저장
  const product = await this.productService.create(dto);
  
  // 이벤트 발행 (비동기)
  this.eventEmitter.emit('product.created', product);
  
  return product;
}

// 2. 이벤트 리스너가 ES 동기화
@OnEvent('product.created')
async syncToElasticsearch(product: Product) {
  // JOIN으로 모든 정보 조회
  const fullProduct = await this.getProductWithAllRelations(product.id);
  
  // 임베딩 생성
  const embedding = await this.embeddingService.generate(
    `${fullProduct.name} ${fullProduct.description}`
  );
  
  // ES에 인덱싱 (비정규화)
  await this.esClient.index({
    index: 'products',
    id: product.id,
    document: {
      ...fullProduct,
      category_name: fullProduct.category.name,
      category_path: fullProduct.category.path,
      tags: fullProduct.tags.map(/* ... */),
      tag_value_ids: fullProduct.tags.map(t => t.valueId),
      name_embedding: embedding,
    }
  });
}
```

---

## 데이터 모델

### PostgreSQL 스키마

#### 1. 태그 그룹 (Tag Groups)

```sql
CREATE TABLE tag_groups (
  id VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tag_groups_active ON tag_groups(is_active);
CREATE INDEX idx_tag_groups_display_order ON tag_groups(display_order);
```

#### 2. 태그 값 (Tag Values)

```sql
CREATE TABLE tag_values (
  id VARCHAR(30) PRIMARY KEY,
  group_id VARCHAR(30) NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tag_values_group_id ON tag_values(group_id);
CREATE INDEX idx_tag_values_active ON tag_values(is_active);
CREATE INDEX idx_tag_values_display_order ON tag_values(group_id, display_order);
CREATE UNIQUE INDEX unique_tag_values_group_name ON tag_values(group_id, name);
```

#### 3. 카테고리 ↔ 태그 그룹 연결

```sql
CREATE TABLE category_tag_groups (
  category_id UUID NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  tag_group_id VARCHAR(30) NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
  display_order INT DEFAULT 0,
  is_required BOOLEAN DEFAULT false,
  applies_to_descendants BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (category_id, tag_group_id)
);

CREATE INDEX idx_category_tag_groups_category ON category_tag_groups(category_id);
CREATE INDEX idx_category_tag_groups_group ON category_tag_groups(tag_group_id);
CREATE INDEX idx_category_tag_groups_display_order ON category_tag_groups(category_id, display_order);
```

#### 4. 상품 ↔ 태그 값 연결

```sql
CREATE TABLE product_tag_values (
  product_id UUID NOT NULL REFERENCES product_masters(id) ON DELETE CASCADE,
  tag_value_id VARCHAR(30) NOT NULL REFERENCES tag_values(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (product_id, tag_value_id)
);

CREATE INDEX idx_product_tag_values_product ON product_tag_values(product_id);
CREATE INDEX idx_product_tag_values_tag ON product_tag_values(tag_value_id);
```

### Drizzle ORM 스키마 정의

```typescript
// apps/pim/src/schema.ts

// Tag Groups
export const tagGroups = pgTable(
  'tag_groups',
  {
    id: varchar('id', { length: 30 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    displayOrder: integer('display_order').default(0),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_tag_groups_active').on(table.isActive),
    index('idx_tag_groups_display_order').on(table.displayOrder),
  ],
);

// Tag Values
export const tagValues = pgTable(
  'tag_values',
  {
    id: varchar('id', { length: 30 }).primaryKey(),
    groupId: varchar('group_id', { length: 30 })
      .notNull()
      .references(() => tagGroups.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    displayOrder: integer('display_order').default(0),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_tag_values_group_id').on(table.groupId),
    index('idx_tag_values_active').on(table.isActive),
    uniqueIndex('unique_tag_values_group_name').on(table.groupId, table.name),
  ],
);

// Category ↔ Tag Group
export const categoryTagGroups = pgTable(
  'category_tag_groups',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => productCategories.id, { onDelete: 'cascade' }),
    tagGroupId: varchar('tag_group_id', { length: 30 })
      .notNull()
      .references(() => tagGroups.id, { onDelete: 'cascade' }),
    displayOrder: integer('display_order').default(0),
    isRequired: boolean('is_required').default(false),
    appliesToDescendants: boolean('applies_to_descendants').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_category_tag_groups_category').on(table.categoryId),
    index('idx_category_tag_groups_group').on(table.tagGroupId),
  ],
);

// Product ↔ Tag Value
export const productTagValues = pgTable(
  'product_tag_values',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => productMasters.id, { onDelete: 'cascade' }),
    tagValueId: varchar('tag_value_id', { length: 30 })
      .notNull()
      .references(() => tagValues.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_product_tag_values_product').on(table.productId),
    index('idx_product_tag_values_tag').on(table.tagValueId),
  ],
);

// Relations
export const tagGroupsRelations = relations(tagGroups, ({ many }) => ({
  values: many(tagValues),
  categories: many(categoryTagGroups),
}));

export const tagValuesRelations = relations(tagValues, ({ one, many }) => ({
  group: one(tagGroups, {
    fields: [tagValues.groupId],
    references: [tagGroups.id],
  }),
  products: many(productTagValues),
}));

export const categoryTagGroupsRelations = relations(categoryTagGroups, ({ one }) => ({
  category: one(productCategories, {
    fields: [categoryTagGroups.categoryId],
    references: [productCategories.id],
  }),
  tagGroup: one(tagGroups, {
    fields: [categoryTagGroups.tagGroupId],
    references: [tagGroups.id],
  }),
}));

export const productTagValuesRelations = relations(productTagValues, ({ one }) => ({
  product: one(productMasters, {
    fields: [productTagValues.productId],
    references: [productMasters.id],
  }),
  tagValue: one(tagValues, {
    fields: [productTagValues.tagValueId],
    references: [tagValues.id],
  }),
}));
```

---

## 검색 쿼리 설계

### 1. Hybrid Search (키워드 + 벡터)

```json
POST /pim_products/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "multi_match": {
            "query": "아이폰 256",
            "fields": ["name^3", "name.autocomplete^2", "description"],
            "fuzziness": "AUTO",
            "operator": "or"
          }
        }
      ],
      "filter": [
        { "term": { "status": "active" } },
        { "term": { "approval_status": "approved" } }
      ]
    }
  },
  "knn": {
    "field": "name_embedding",
    "query_vector": [0.123, 0.456, ...],
    "k": 50,
    "num_candidates": 100,
    "boost": 2.0
  },
  "rank": {
    "rrf": {
      "window_size": 50,
      "rank_constant": 60
    }
  }
}
```

### 2. 태그 필터링

```json
POST /pim_products/_search
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "category_id": "cat_lash_001" } },
        { "terms": { "tag_value_ids": ["tv_c_curl", "tv_015t"] } }
      ]
    }
  },
  "aggs": {
    "tags_by_group": {
      "nested": {
        "path": "tags"
      },
      "aggs": {
        "groups": {
          "terms": {
            "field": "tags.group_id",
            "size": 50
          },
          "aggs": {
            "group_name": {
              "top_hits": {
                "size": 1,
                "_source": ["tags.group_name"]
              }
            },
            "values": {
              "terms": {
                "field": "tags.value_id",
                "size": 100
              },
              "aggs": {
                "value_name": {
                  "top_hits": {
                    "size": 1,
                    "_source": ["tags.value_name"]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 3. 자동완성

```json
POST /pim_products/_search
{
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "name.autocomplete": {
              "query": "아이",
              "boost": 2.0
            }
          }
        },
        {
          "match_phrase_prefix": {
            "name": {
              "query": "아이",
              "boost": 1.5
            }
          }
        }
      ]
    }
  },
  "size": 10,
  "_source": ["product_id", "name", "category_name"]
}
```

---

## 구현 로드맵

### Phase 1: 기반 구축 (2주)

#### Week 1: 데이터 모델 및 인프라
- [x] PostgreSQL 스키마 추가 (태그 테이블)
  - [x] `tag_groups` 테이블 정의
  - [x] `tag_values` 테이블 정의
  - [x] 인덱스 및 Foreign Key 설정
- [x] Drizzle ORM 스키마 정의
  - [x] `tagGroups`, `tagValues` 스키마
  - [x] Relations 정의
  - [x] TypeScript 타입 정의 (types.ts)
- [x] Elasticsearch 클러스터 구축 (Railway 배포)
- [x] Elasticsearch 인덱스 매핑 정의
- [x] NestJS Elasticsearch 모듈 설정

#### Week 2: 기본 CRUD 및 동기화
- [x] 태그 관리 API 구현 (기본 CRUD)
  - [x] Tag Group CRUD
  - [x] Tag Value CRUD
  - [x] Category ↔ Tag Group 연결 API
- [x] 상품-태그 연결 API (Phase 2 완료)
- [x] 이벤트 기반 동기화 구현
  - [x] ProductMaster 이벤트 정의
  - [x] Kafka 이벤트 발행 로직
  - [x] Elasticsearch 동기화 서비스
  - [x] 에러 핸들링 및 로깅

**산출물**:
- [x] Drizzle 스키마 및 타입 정의
- [x] 태그 관리 API 문서 (Swagger)
- [x] 기본 CRUD 서비스 구현
- [x] Category-Tag Group 연결 API 구현
- [x] ProductMaster 이벤트 스키마
- [x] Elasticsearch 동기화 로직
- [x] 초기 데이터 마이그레이션 스크립트

---

### Phase 2: 검색 기능 구현 (2주)

#### Week 3: 기본 검색
- [ ] 임베딩 서비스 구축
  - OpenAI API 또는 로컬 모델 선택
  - 임베딩 생성 및 캐싱
- [ ] Hybrid Search 구현
  - Keyword Search (Fuzzy + Synonym)
  - Vector Search (kNN)
  - RRF Fusion
- [ ] 필터링 쿼리 구현

#### Week 4: 고급 검색
- [ ] 태그 필터링 + Aggregation
- [ ] 자동완성 API
- [ ] 검색 결과 하이라이팅
- [ ] 검색 로깅 및 분석

**산출물**:
- 검색 API 문서
- 성능 테스트 결과
- 검색 품질 평가 리포트

---

### Phase 3: 최적화 및 배포 (2주)

#### Week 5: 성능 최적화
- [ ] Elasticsearch 튜닝
  - Shard 설정 최적화
  - Replica 설정
  - Refresh Interval 조정
- [ ] 캐싱 전략 (Redis)
  - 인기 검색어 캐싱
  - 필터 옵션 캐싱
- [ ] 배치 동기화 (초기 데이터)

#### Week 6: 모니터링 및 배포
- [ ] Elasticsearch 모니터링 대시보드
- [ ] 검색 품질 메트릭 수집
  - CTR (Click-Through Rate)
  - Zero Result Rate
- [ ] 프로덕션 배포
- [ ] 문서화 완료

**산출물**:
- 모니터링 대시보드
- 운영 가이드
- 최종 설계 문서

---

### Phase 4: 고도화 (선택 사항)

- [ ] Cross-encoder Reranking 모델 추가
- [ ] 개인화 검색 (사용자 행동 기반)
- [ ] A/B 테스트 프레임워크
- [ ] 검색어 추천 (Did you mean?)
- [ ] 관련 상품 추천

---

## 기술 스택 및 의사결정

### Elasticsearch 버전
- **선택**: Elasticsearch 8.11+
- **이유**:
  - Dense Vector 필드 안정화
  - RRF 기능 내장 (8.8+)
  - HNSW 알고리즘 성능 개선
  - 한글 Nori Analyzer 기본 제공

### 임베딩 모델

#### 옵션 1: OpenAI API (추천)
- **모델**: `text-embedding-3-small` (1536차원)
- **장점**:
  - 높은 품질
  - 관리 불필요
  - 빠른 응답 (배치 처리 가능)
- **단점**:
  - API 비용 발생 (~$0.02 / 1M 토큰)
  - 외부 의존성

**비용 추정**:
```
상품 수: 10,000건
평균 텍스트 길이: 100 토큰
임베딩 비용: 10,000 × 100 / 1,000,000 × $0.02 = $0.02
→ 초기 임베딩: $0.02
→ 일일 신규/수정 상품 100건: $0.0002/day = $0.06/month
```

#### 옵션 2: 로컬 모델 (Hugging Face)
- **모델**: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384차원)
- **장점**:
  - 비용 없음
  - 데이터 외부 유출 없음
- **단점**:
  - GPU 인프라 필요
  - 품질 낮음 (상대적)
  - 유지보수 부담

**권장**: Phase 1에서는 OpenAI 사용, 추후 필요 시 로컬 모델 전환

### 동기화 전략

#### 이벤트 기반 동기화 (추천)
```typescript
@OnEvent('product.created')
@OnEvent('product.updated')
@OnEvent('product.deleted')
async syncToElasticsearch(event)
```

**장점**:
- 실시간에 가까운 동기화
- 코드 로직과 자연스럽게 통합
- 구현 단순

**단점**:
- 대량 업데이트 시 부하

#### CDC (Change Data Capture) - 미래 고려
```
PostgreSQL WAL → Debezium → Kafka → ES Consumer
```

**시기**: 일일 업데이트 1,000건 이상 시 고려

---

## 리스크 및 고려사항

### 1. 데이터 동기화 일관성

**리스크**:
- PostgreSQL과 Elasticsearch 간 데이터 불일치
- 동기화 실패 시 누락 발생

**대응책**:
- 이벤트 재시도 로직 (최대 3회)
- 실패 시 Dead Letter Queue
- 일일 배치 동기화로 보정
- 모니터링 알림 (동기화 지연 > 5분)

```typescript
@OnEvent('product.updated', { async: true })
async syncWithRetry(product: Product) {
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      await this.esClient.index({...});
      return;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        await this.deadLetterQueue.add({ product, error });
        this.logger.error(`Sync failed after ${maxAttempts} attempts`);
      } else {
        await this.sleep(2 ** attempts * 1000); // Exponential backoff
      }
    }
  }
}
```

### 2. 검색 품질

**리스크**:
- 임베딩 모델의 한국어 성능 제한
- 관련도 낮은 결과 노출

**대응책**:
- A/B 테스트로 가중치 조정 (Keyword vs Vector)
- 사용자 피드백 수집 (도움이 되었나요?)
- 검색 로그 분석 및 개선
- Zero Result 검색어 모니터링

**메트릭**:
- Recall@10 (상위 10개 중 관련 상품 비율)
- MRR (Mean Reciprocal Rank)
- Zero Result Rate
- CTR (클릭률)

### 3. 성능 및 비용

**Elasticsearch 비용**:
- 개발: Docker Compose (무료)
- 프로덕션: AWS OpenSearch Service
  - t3.small.search × 2노드: ~$80/month
  - 스토리지 100GB: ~$10/month
  - **총 예상**: ~$100/month

**OpenAI API 비용**:
- 초기 임베딩: ~$0.02
- 월간 운영: ~$0.10
- **총 예상**: 무시 가능

**대응책**:
- Phase 1에서 비용 모니터링
- 필요 시 로컬 임베딩 모델 전환 고려

### 4. 복잡도 증가

**리스크**:
- 두 개의 DB 운영 (PostgreSQL + Elasticsearch)
- 디버깅 어려움 증가

**대응책**:
- 명확한 책임 분리 (CQRS)
- 상세한 로깅 및 모니터링
- 개발자 교육 (Elasticsearch 기본 개념)
- Runbook 작성 (장애 대응 절차)

### 5. 마이그레이션

**리스크**:
- 기존 검색 API 호환성
- 프론트엔드 수정 필요

**대응책**:
- 점진적 마이그레이션
  - Phase 1: 신규 API 추가 (기존 유지)
  - Phase 2: 프론트엔드 전환
  - Phase 3: 기존 API 제거
- Feature Flag로 전환 제어
- 충분한 테스트 기간 (2주)

---

## 모니터링 및 운영

### 핵심 메트릭

#### 검색 성능
- 평균 응답 시간: < 100ms (목표)
- 95 percentile: < 200ms
- 99 percentile: < 500ms

#### 검색 품질
- Zero Result Rate: < 5%
- CTR: > 20%
- Recall@10: > 80%

#### 시스템 헬스
- Elasticsearch 클러스터 상태: Green
- 동기화 지연: < 5분
- 동기화 실패율: < 0.1%

### 알림 조건
- Elasticsearch 클러스터 Yellow/Red
- 평균 응답 시간 > 200ms (5분간)
- 동기화 실패 연속 3회
- Zero Result Rate > 10% (1시간)

---

## 부록

### A. API 명세 예시

#### 1. 상품 검색
```
GET /api/products/search

Query Parameters:
- keyword: string (검색어)
- categoryId: string (카테고리 ID)
- tagValueIds: string[] (태그 값 ID 배열)
- brands: string[] (브랜드 배열)
- minPrice: number
- maxPrice: number
- sortBy: 'relevance' | 'price' | 'createdAt'
- sortOrder: 'asc' | 'desc'
- page: number
- limit: number

Response:
{
  "items": [
    {
      "id": "uuid",
      "name": "상품명",
      "description": "설명",
      "price": 10000,
      "thumbnail": "url",
      "tags": [
        {
          "groupName": "컬 모양",
          "valueName": "C컬"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  },
  "filters": {
    "tags": [
      {
        "groupId": "tg_001",
        "groupName": "컬 모양",
        "values": [
          {
            "id": "tv_001",
            "name": "C컬",
            "count": 45
          }
        ]
      }
    ]
  }
}
```

#### 2. 필터 옵션 조회
```
GET /api/products/filters?categoryId={categoryId}

Response:
{
  "categoryId": "cat_001",
  "categoryName": "속눈썹 연장 > 가모",
  "tagGroups": [
    {
      "id": "tg_001",
      "name": "컬 모양",
      "displayOrder": 1,
      "values": [
        {
          "id": "tv_001",
          "name": "C컬",
          "productCount": 45
        }
      ]
    }
  ]
}
```

### B. 참고 자료

- [Elasticsearch Dense Vector Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/dense-vector.html)
- [Elasticsearch kNN Search](https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html)
- [Korean (Nori) Analysis Plugin](https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-nori.html)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)

---

## 구현 현황 (2025-11-23 기준)

### ✅ 완료된 기능

#### 기본 인프라
- [x] PostgreSQL 스키마 정의 (`tag_groups`, `tag_values`, `category_tag_groups`, `product_tag_values`)
- [x] Drizzle ORM 통합
- [x] TypeScript 타입 정의
- [x] NestJS 모듈 구조 (`TagsModule`)

#### Tag Groups API
- [x] 생성 (POST /tags/groups)
- [x] 목록 조회 (GET /tags/groups?isActive=true/false)
- [x] 단일 조회 (GET /tags/groups/:id)
- [x] 상세 조회 with values (GET /tags/groups/:id/detail)
- [x] 수정 (PUT /tags/groups/:id)
- [x] 삭제 (DELETE /tags/groups/:id)

#### Tag Values API
- [x] 생성 (POST /tags/groups/:groupId/values)
- [x] 그룹별 목록 조회 (GET /tags/groups/:groupId/values)
- [x] 단일 조회 (GET /tags/values/:id)
- [x] 수정 (PUT /tags/values/:id)
- [x] 삭제 (DELETE /tags/values/:id)

#### Category-Tag Group 연결 API
- [x] 카테고리 생성/수정 시 태그 그룹 연결 (선택적)
- [x] 태그 그룹 연결 설정 (PUT /categories/:categoryId/tag-groups)
- [x] 카테고리의 태그 그룹 조회 (GET /categories/:categoryId/tag-groups)

#### 태그 그룹 상속 기능
- [x] `applies_to_descendants` 필드 추가 (스키마 + DTO)
- [x] 조상 카테고리 조회 헬퍼 메소드 (재귀 CTE)
- [x] 상속 중복 검증 (태그 그룹 연결 시)
- [x] 상속받은 태그 그룹 포함 조회
- [x] 상속 출처 정보 포함 (isInherited, inheritedFromCategoryId, inheritedFromCategoryName)
- [x] displayOrder 통합 정렬

#### 추가 구현 사항
- [x] DTO validation (class-validator + class-transformer)
- [x] Query parameter 자동 변환 (`@Transform` 데코레이터)
- [x] 중복 name 검증 (같은 그룹 내)
- [x] Cascade 삭제 방지 (tag group에 values가 있으면 삭제 불가)
- [x] Swagger 문서 자동 생성
- [x] 트랜잭션 지원
- [x] 태그 그룹 존재 확인 및 검증

#### 상품-태그 연결 (Phase 2 완료)
- [x] **태그 Soft Delete 구현**
  - [x] `deleteTagGroup()`, `deleteTagValue()`: Hard delete → Soft delete (isActive = false)
  - [x] `listTagGroups()`, `listTagValuesByGroup()`: 기본적으로 isActive = true만 조회
  - [x] Foreign Key Cascade 제거 (cascade → restrict)
- [x] **`product_tag_values` 스키마 변경 (버전별 매핑)**
  - [x] `productId` → `masterId + version` 구조로 변경
  - [x] Primary Key: (masterId, version, tagValueId)
  - [x] 인덱스 추가: `idx_product_tag_values_master_version`
  - [x] Relations 수정: productMasters 관계 제거 (논리적 참조만 유지)
- [x] **상품 수정 API에 태그 연결 기능 추가**
  - [x] `UpdateProductMasterDto.tagValueIds` 필드 추가
  - [x] `ProductMastersService.updateMaster()`: 태그 업데이트 로직 구현
  - [x] 비활성화된 태그 연결 시 에러 발생
  - [x] 중복 UUID 검증 (`@ArrayUnique()` + 서비스 레벨 체크)
  - [x] 명확한 에러 메시지 (잘못된 ID 목록 표시)
- [x] **Draft 버전 관리에 태그 로직 통합**
  - [x] `ProductVersionsService._copyMappings()`: 활성화된 태그만 새 버전으로 복사
  - [x] `ProductVersionsService.deleteDraftVersion()`: 태그 매핑 자동 삭제
- [x] **Types 업데이트**
  - [x] `ProductTagValue` 타입 자동 업데이트 (InferSelectModel)
  - [x] `UpdateProductMaster` 타입에 `tagValueIds` 필드 추가

#### 상품 조회 API에 태그 정보 포함 (Phase 3 완료)
- [x] **태그 정보 DTO 정의**
  - [x] `ProductTagDto` 클래스 생성 (플랫 배열 구조)
  - [x] `MasterDetailDto`에 `tagValues` 필드 추가
- [x] **상품 상세 조회에 태그 정보 포함**
  - [x] `getMasterDetail()`: `productTagValues` JOIN 쿼리 추가
  - [x] `tagGroups`, `tagValues` 테이블 JOIN
  - [x] 활성화된 태그만 조회 (`isActive=true`)
  - [x] `displayOrder` 기준 정렬
- [ ] 상품 목록 조회에 태그 필터링 옵션 추가 (선택적, 추후 구현)

#### Elasticsearch 통합 (Phase 4 완료)
- [x] **패키지 설치 및 환경 설정**
  - [x] `@elastic/elasticsearch` v9.2.0 설치
  - [x] TypeScript 타입 정의 추가 (`@types/elasticsearch`)
  - [x] 환경 변수 추가 (`ELASTICSEARCH_NODE`, `ELASTICSEARCH_USERNAME`, `ELASTICSEARCH_PASSWORD`)
  - [x] Zod 스키마 검증 구현 (`pimEnvSchema`)
- [x] **ProductMaster 이벤트 시스템**
  - [x] `ProductMasterActiveVersionChanged` 이벤트 정의
    - Payload: masterId, productId, version, name, previousActiveVersionId, changeReason, changedAt
    - changeReason: 'published' (신규), 'unpublished' (비활성화), 'rollback' (버전 롤백)
    - Zod 스키마로 페이로드 검증
  - [x] `ProductMasterDeleted` 이벤트 정의
    - Payload: masterId, deletedAt
    - Zod 스키마로 페이로드 검증
  - [x] `PRODUCT_STREAM`에 이벤트 등록 (`packages/event-contracts`)
- [x] **이벤트 발행 구현**
  - [x] `ProductVersionsService._emitActiveVersionChangedEvent()`: 
    - `publishVersion()` 호출 시 active 버전 변경 이벤트 발행
    - changeReason 로직 구현 (published/unpublished/rollback)
    - 에러 핸들링 및 로깅
  - [x] `ProductMastersService._emitMasterDeletedEvent()`:
    - `softDelete()` 호출 시 삭제 이벤트 발행 (active 상품만)
    - 에러 핸들링 및 로깅
  - [x] Kafka `StreamPublisher` DI 통합
- [x] **Elasticsearch 모듈 구조**
  - [x] `apps/pim/src/search/` 디렉토리 생성
  - [x] `ElasticsearchModule` 생성 및 `PimModule`에 통합
  - [x] `EventsModule.forConsumer` 통합 (Kafka 이벤트 소비)
  - [x] DTO 정의:
    - `ProductSearchRequestDto`: 검색 요청 (keyword, categoryId, tagFilters, price range 등)
    - `ProductSearchResponseDto`: 검색 응답 (items, pagination, filters aggregation)
    - `ProductSearchItemDto`: 검색 결과 아이템
  - [x] 서비스 구현:
    - `ElasticsearchService`: 클라이언트 wrapper, health check
    - `ElasticsearchIndexService`: 인덱스 생성/삭제/매핑 업데이트
    - `ElasticsearchSyncService`: Kafka 이벤트 리스너, 동기화 로직
    - `ProductSearchService`: 검색 쿼리 빌더 (keyword, filter, aggregation)
    - `ProductSearchController`: 검색 API 엔드포인트 (GET /products/search)
- [x] **인덱스 매핑 정의**
  - [x] `apps/pim/src/search/types/index-mappings.ts` 생성
  - [x] 텍스트 검색 필드: name, description (Korean Nori analyzer)
  - [x] 필터링 필드: category_id, brand, status, price, stock_quantity
  - [x] 태그 필드: nested 구조 (group_id, group_name, value_id, value_name)
  - [x] 플랫 배열: tag_value_ids (빠른 필터링용)
  - [x] 벡터 필드 준비: name_embedding, full_embedding (dense_vector, 768 dims)
  - [x] 자동완성 필드: name.autocomplete (Edge N-gram)
  - [x] 동의어 필터 설정 준비
- [x] **태그 필터링 로직**
  - [x] 그룹 내 OR 연산: 같은 태그 그룹의 값들은 OR로 연결
  - [x] 그룹 간 AND 연산: 다른 태그 그룹들은 AND로 연결
  - [x] Nested query 구현
  - [x] DTO validation (TagFilterDto)
- [x] **초기 데이터 마이그레이션**
  - [x] `apps/pim/scripts/migrate-to-elasticsearch.ts` 스크립트 생성
  - [x] PostgreSQL에서 active 상품 조회 (JOIN: category, tags)
  - [x] Elasticsearch 문서 변환 (비정규화)
  - [x] Bulk indexing 구현
  - [x] 진행 상황 로깅
  - [x] NPM 스크립트 추가: `pim:migrate-es`
- [x] **검색 API 구현**
  - [x] GET `/products/search` 엔드포인트
  - [x] 쿼리 파라미터: keyword, categoryId, tagFilters, brands, minPrice, maxPrice, sortBy, sortOrder, page, limit
  - [x] 응답: items, pagination, filters (aggregations)
  - [x] Swagger 문서 자동 생성

#### Elasticsearch 기반 인프라 (Phase 4 완료)
- [x] **Elasticsearch 패키지 설치**
  - [x] `@elastic/elasticsearch` v9.2.0 설치
  - [x] Apache Arrow 의존성 자동 설치
- [x] **환경 변수 구성**
  - [x] `ELASTICSEARCH_NODE` 추가 (URL 형식 검증)
  - [x] `ELASTICSEARCH_USERNAME` 추가 (선택적)
  - [x] `ELASTICSEARCH_PASSWORD` 추가 (선택적)
  - [x] Zod 스키마 검증 (`pimEnvSchema`)
- [x] **ProductMaster 이벤트 정의**
  - [x] `ProductMasterActiveVersionChanged` 이벤트 추가
    - Payload: masterId, productId, version, name, previousActiveVersionId, changeReason, changedAt
    - changeReason: 'published' | 'unpublished' | 'rollback'
  - [x] `ProductMasterDeleted` 이벤트 추가
    - Payload: masterId, deletedAt
  - [x] Zod 스키마 정의 및 validation
- [x] **이벤트 발행 로직 구현**
  - [x] `ProductVersionsService.publishVersion()`: Active version 변경 시 이벤트 발행
  - [x] `ProductMastersService.softDelete()`: Active 상품 삭제 시 이벤트 발행
  - [x] 에러 핸들링 및 로깅
- [x] **Elasticsearch 모듈 구조**
  - [x] `ElasticsearchModule` 생성 및 PIM 모듈에 통합
  - [x] `ElasticsearchService` (클라이언트 wrapper)
  - [x] `ElasticsearchIndexService` (인덱스 관리)
  - [x] `ElasticsearchSyncService` (Kafka 이벤트 리스너)
  - [x] `ProductSearchService` (검색 로직)
  - [x] `ProductSearchController` (검색 API)
- [x] **인덱스 매핑 정의**
  - [x] 텍스트 검색 필드 (name, description)
  - [x] Korean analyzer 설정 (Nori)
  - [x] 동의어 필터 준비
  - [x] Nested 태그 구조
  - [x] Dense vector 필드 (embedding 준비)
- [x] **초기 데이터 마이그레이션**
  - [x] `apps/pim/scripts/migrate-to-elasticsearch.ts` 스크립트 생성
  - [x] NPM 스크립트 추가: `pim:migrate-es`
  - [x] PostgreSQL → Elasticsearch 데이터 동기화
  - [x] 태그 정보 포함 (JOIN)

### 🔄 다음 단계 (Phase 5)

#### 검색 기능 고도화
- [ ] **Hybrid Search 구현**
  - [ ] OpenAI 임베딩 서비스 연동
  - [ ] Vector Search + Keyword Search 융합 (RRF)
  - [ ] 가중치 조정 및 A/B 테스트
- [ ] **고급 검색 기능**
  - [ ] 자동완성 API
  - [ ] 검색어 하이라이팅
  - [ ] 오타 교정 (Fuzzy Search)
  - [ ] 동의어 확장
- [ ] **태그 기반 Aggregation**
  - [ ] 그룹별 필터 옵션 집계
  - [ ] 동적 필터 UI 데이터 제공
- [ ] **성능 최적화**
  - [ ] Elasticsearch 튜닝 (shard, replica)
  - [ ] 캐싱 전략 (Redis)
  - [ ] 모니터링 및 알림 설정

### 📝 주의사항

1. **마이그레이션 필수**: `product_tag_values` 스키마 변경으로 인해 마이그레이션 필요
   ```bash
   cd apps/pim
   npx drizzle-kit generate
   npx drizzle-kit migrate
   ```
   - 기존 데이터가 있다면 수동 마이그레이션 필요 (productId → masterId + version)
2. **Elasticsearch 초기 설정**: 
   ```bash
   # 환경 변수 설정 (.env)
   ELASTICSEARCH_NODE=https://your-railway-url:9200
   ELASTICSEARCH_USERNAME=elastic  # 선택적
   ELASTICSEARCH_PASSWORD=your-password  # 선택적
   
   # 초기 데이터 마이그레이션
   npm run pim:migrate-es
   ```
   - Railway 또는 AWS OpenSearch 등 Elasticsearch 클러스터가 먼저 배포되어 있어야 함
   - 인덱스 생성 및 초기 데이터 동기화는 마이그레이션 스크립트가 자동 수행
3. **이벤트 기반 동기화**: 
   - Kafka 이벤트가 정상 작동해야 실시간 동기화 가능
   - `ProductMasterActiveVersionChanged`, `ProductMasterDeleted` 이벤트 확인
   - 동기화 실패 시 로그 확인 및 재시도 필요
4. **ValidationPipe**: PIM `main.ts`에서 활성화됨 - 다른 컨트롤러에 영향 가능성 확인 필요
5. **ID 생성**: UUID v7 사용 (PIM 전체 일관성)
6. **RESTful 설계**: `/tags/groups/:groupId/values` 패턴 유지
7. **태그 삭제 정책**: Soft delete 사용으로 과거 버전의 데이터 무결성 보장
8. **버전 관리**: 삭제된 태그는 새 Draft 생성 시 자동으로 제외됨

---

## 변경 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 2025-11-23 | 1.0 | 초안 작성 | AI Agent |
| 2025-11-23 | 1.1 | Phase 1 부분 구현 완료 (태그 기본 CRUD) | AI Agent |
| 2025-11-23 | 1.2 | Category-Tag Group 연결 기능 구현 완료 | AI Agent |
| 2025-11-23 | 1.3 | 태그 그룹 상속 기능 구현 완료 (applies_to_descendants) | AI Agent |
| 2025-11-23 | 1.4 | Phase 2 구현 완료 (상품-태그 연결, 버전별 매핑, Soft Delete) | AI Agent |
| 2025-11-23 | 1.5 | Phase 3 구현 완료 (상품 조회 API에 태그 정보 포함) | AI Agent |
| 2025-11-23 | 1.6 | Phase 4 구현 완료 (Elasticsearch 통합 인프라, 이벤트 시스템, 초기 마이그레이션) | AI Agent |

---

## 데이터 마이그레이션 스크립트 (Phase 2)

### productTagValues 스키마 변경 마이그레이션

기존 `product_tag_values` 데이터가 있는 경우, 다음 SQL 스크립트로 마이그레이션:

```sql
-- 1. 기존 데이터 백업
CREATE TABLE product_tag_values_backup AS 
SELECT * FROM product_tag_values;

-- 2. 기존 테이블 삭제 (Drizzle 마이그레이션이 새 구조로 재생성)
DROP TABLE product_tag_values CASCADE;

-- 3. Drizzle 마이그레이션 실행
-- (drizzle-kit migrate 명령어 실행)

-- 4. 데이터 복원 (productId → masterId + version 변환)
INSERT INTO product_tag_values (master_id, version, tag_value_id, created_at)
SELECT 
  pm.master_id,
  pm.version,
  ptv_backup.tag_value_id,
  ptv_backup.created_at
FROM product_tag_values_backup ptv_backup
INNER JOIN product_masters pm ON pm.id = ptv_backup.product_id
WHERE pm.deleted_at IS NULL;  -- 삭제된 상품 제외

-- 5. 마이그레이션 검증
SELECT 
  COUNT(*) as backup_count,
  (SELECT COUNT(*) FROM product_tag_values) as migrated_count
FROM product_tag_values_backup;

-- 6. 검증 완료 후 백업 테이블 삭제 (선택 사항)
-- DROP TABLE product_tag_values_backup;
```

### 마이그레이션 체크리스트

- [ ] Drizzle 마이그레이션 파일 생성 (`drizzle-kit generate`)
- [ ] 데이터베이스 백업 수행
- [ ] 마이그레이션 SQL 스크립트 검토
- [ ] 개발 환경에서 테스트
- [ ] 프로덕션 마이그레이션 실행
- [ ] 데이터 정합성 검증
- [ ] 백업 테이블 정리

---

## 승인

- [ ] CTO 검토
- [ ] 백엔드 팀 리드 검토
- [ ] 프론트엔드 팀 리드 검토
- [ ] DevOps 팀 검토

