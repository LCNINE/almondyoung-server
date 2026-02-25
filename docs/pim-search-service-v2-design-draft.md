# PIM 검색 서비스 재설계 초안 (v0.1)

**작성일**: 2026-02-10  
**상태**: Draft  
**대상**: PIM 상품 검색 고도화 (오타 허용, 의미 검색, 랭킹 고도화, 개인화 준비)

---

## 1. 목적

현재 PIM 내부 Elasticsearch 기반 검색을 검색 전용 서비스로 분리하고, 다음 요구사항을 단계적으로 충족하는 실행 가능한 설계 초안을 제시한다.

- 기본 검색, 필터링, 정렬
- 한글 오타/띄어쓰기 변형 허용 (`노몬드글루`, `노몬느 들루` 등)
- 임베딩 기반 의미 검색 (`접착제` 검색 시 `글루` 계열 회수)
- 향후 판매량/개인화/리뷰 신호를 결합한 랭킹 고도화

---

## 2. 배경 및 현재 한계

현재 구현은 `apps/pim/src/search` 내부에 포함되어 있고, 검색과 도메인 로직이 강결합되어 있다.

핵심 한계:

- 검색 로직이 `multi_match + fuzziness: AUTO` 중심이며(`apps/pim/src/search/product-search.service.ts`), 한글 띄어쓰기/복합 오타 대응이 제한적
- 매핑이 `standard analyzer` 기반(`apps/pim/src/search/types/index-mappings.ts`)이라 한국어 검색 튜닝 여지가 낮음
- 향후 랭킹 실험(판매량/개인화/리뷰)과 검색 API 운영을 분리하기 어려움
- 인덱스 동기화/검색 API/도메인 서비스가 PIM 프로세스 안에서 함께 변경되어 배포 리스크가 큼

---

## 3. 의사결정 초안

### 3.1 서비스 분리

검색 기능은 **새 마이크로서비스로 분리**한다.

- 도메인 소스 오브 트루스: PIM DB
- 검색 소스 오브 트루스: OpenSearch 인덱스
- 동기화 방식: 이벤트 기반 비동기 인덱싱

### 3.2 검색 엔진

초기 기준 엔진은 **OpenSearch**로 제안한다.

선정 이유:

- 기본 검색/필터/집계/정렬 기능 성숙
- 오타 허용(fuzzy), 분석기/토크나이저 튜닝, synonym 운용 가능
- 벡터 검색과 하이브리드 검색(BM25 + Vector) 확장 용이
- 향후 랭킹 파이프라인(비즈니스 신호, 개인화 신호) 통합에 유리

---

## 4. 목표 아키텍처

### 4.1 구성요소

1. `search-api`  
   - 상품 검색 API 제공 (`/search/products`)
   - 질의 정규화, 필터 파싱, 정렬/페이징, 응답 포맷 제공

2. `search-indexer`  
   - PIM 이벤트 소비 (`products.events.v1`)
   - 상품 문서 upsert/delete
   - 백필(reindex) 배치 수행

3. `search-feature-updater`  
   - 판매량/클릭/구매/리뷰 배치 집계
   - 랭킹 피처 필드 갱신 (예: `sales_30d`, `hold_score`)

4. `opensearch`  
   - 인덱스/별칭 운영
   - 검색/집계/벡터 질의 수행

### 4.2 서비스 경계

- PIM은 상품 마스터 데이터 관리에 집중
- Search 서비스는 검색 UX/랭킹 실험/성능 최적화에 집중
- API Gateway 또는 BFF가 검색 endpoint를 Search 서비스로 라우팅

---

## 5. 인덱스 설계 초안

### 5.1 인덱스 운영 전략

- 읽기 별칭: `products_current`
- 쓰기 대상: `products_v{n}`
- 무중단 교체: `products_v1 -> products_v2` 리인덱스 후 alias 스위치

### 5.2 문서 스키마 (초안)

```json
{
  "product_id": "keyword",
  "master_id": "keyword",
  "name": "text",
  "name_ngram": "text",
  "name_no_space": "text",
  "description": "text",
  "brand_id": "keyword",
  "brand_name": "text",
  "category_ids": "keyword[]",
  "tag_value_ids": "keyword[]",
  "price": "long",
  "status": "keyword",
  "created_at": "date",
  "updated_at": "date",
  "sales_7d": "float",
  "sales_30d": "float",
  "ctr_30d": "float",
  "cvr_30d": "float",
  "rating_avg": "float",
  "review_count": "integer",
  "hold_score": "float",
  "semantic_vector": "knn_vector"
}
```

### 5.3 분석기/토큰 전략

- 한국어 형태소 분석기 기반 필드(`name`, `description`)
- n-gram 필드(`name_ngram`)로 부분/오타 회수 보강
- 공백 제거 필드(`name_no_space`)로 붙여쓰기 질의 대응
- synonym 사전으로 도메인 동의어 정규화
  - 예: `접착제, 글루`

---

## 6. 검색 파이프라인 초안

### 6.1 Query 처리 단계

1. Query Normalization  
   - trim, 다중 공백 정리, 특수문자 정리
   - 자주 발생하는 오타 사전 치환(옵션)

2. Lexical Retrieval  
   - BM25 기반 multi-field 검색
   - fuzzy + synonym + n-gram + no-space 조합

3. Semantic Retrieval  
   - 질의를 임베딩 변환
   - `semantic_vector` 유사도 검색

4. Hybrid Fusion  
   - Lexical TopN + Semantic TopN 결합 (RRF 또는 가중합)

5. Re-rank  
   - 비즈니스 신호(판매량/재고/신상품 가중)
   - 사용자 신호(개인화, 세그먼트 선호)
   - 리뷰 속성 신호(`hold_score`)

6. Response Build  
   - facet 집계, 페이지네이션, 디버그 점수(옵션) 반환

---

## 7. 랭킹 전략 (초기안)

### 7.1 스코어 결합식

초기 가중치 예시:

`final_score = 0.55 * lexical + 0.25 * semantic + 0.12 * sales + 0.05 * personalization + 0.03 * review_attr`

운영 원칙:

- 로그인/행동 이력 부족 시 `personalization = 0`으로 안전 폴백
- 카테고리별로 가중치 profile 분리 가능하도록 설계
- 모든 가중치는 실험 플래그로 조정 가능하게 관리

### 7.2 개인화 단계 전략

- Phase A: 규칙 기반 개인화
  - 최근 구매 카테고리/브랜드 boost
  - 고객 세그먼트 기반 가중치
- Phase B: 학습 기반 rerank
  - 클릭/장바구니/구매 로그를 feature로 반영

---

## 8. API 계약 초안

### 8.1 상품 검색

`GET /search/products`

Query Params:

- `q`: 검색어
- `categoryIds[]`, `brandIds[]`
- `priceMin`, `priceMax`
- `sort`: `relevance | price_asc | price_desc | newest | sales`
- `page`, `size`
- `userId`(optional), `sessionId`(optional)

Response 예시:

```json
{
  "items": [
    {
      "productId": "p_123",
      "name": "노몬드 글루",
      "price": 12000,
      "score": 8.41
    }
  ],
  "facets": {
    "brands": [],
    "categories": []
  },
  "total": 120,
  "page": 1,
  "size": 20
}
```

### 8.2 검색 이벤트 수집 (분석/개인화 준비)

- `POST /search/events/impression`
- `POST /search/events/click`
- `POST /search/events/purchase`

수집 목적:

- CTR/CVR 피처 생성
- 개인화 모델 학습/평가 데이터 축적

---

## 9. 데이터 동기화 전략

### 9.1 실시간(준실시간) 동기화

- 이벤트 소비: `ProductMasterActiveVersionChanged`, `ProductMasterDeleted`
- 처리 보장: at-least-once + idempotent upsert
- 재처리 가능성 고려한 version/timestamp 기반 최신성 체크

### 9.2 백필/재색인

- 신규 매핑 적용 시 `products_v{n+1}` 생성
- 전체 backfill 배치 수행
- 검증 후 alias 교체

---

## 10. 릴리즈 단계

### Phase 1 (기본 분리)

- Search 서비스 분리
- 기본 검색/필터/정렬/페이징
- 기존 endpoint와 호환되는 응답 제공

### Phase 2 (오타/동의어 품질 개선)

- 분석기/동의어/띄어쓰기 대응 필드 적용
- 품질 회귀 테스트셋 운영

### Phase 3 (하이브리드 검색)

- 임베딩 생성 파이프라인 도입
- BM25 + Vector 결합 검색 운영

### Phase 4 (랭킹 고도화)

- 판매량/리뷰/개인화 피처 결합 rerank
- A/B 테스트로 가중치 최적화

---

## 11. 성공 지표 (KPI/SLO)

제품 KPI:

- Zero-result rate 감소
- Search CTR@10 증가
- Search 유입 구매전환율 증가

시스템 SLO:

- P95 latency (예: 250ms 이하)
- Index freshness (예: 이벤트 반영 지연 1분 이내)
- 검색 오류율 (5xx 비율) 관리

---

## 12. 리스크 및 대응

1. 동의어/오타 사전 과적용으로 정밀도 저하  
   - 대응: 카테고리별 사전 분리, 오프라인 평가셋 상시 점검

2. 벡터 검색 도입 후 지연시간 증가  
   - 대응: TopN 제한, 하이브리드 결합 단계 최적화, 캐시

3. 개인화 편향(필터 버블)  
   - 대응: 탐색 슬롯(explore slot) 유지, 다양성 제약 도입

4. 이벤트 유실/중복으로 피처 왜곡  
   - 대응: outbox + idempotency key + 재처리 대시보드

---

## 13. 초기 구현 체크리스트

- [ ] `search-api` 서비스 생성 및 `/search/products` 구현
- [ ] `search-indexer` 이벤트 컨슈머 분리
- [ ] OpenSearch 인덱스 템플릿/alias 스크립트 작성
- [ ] 동의어 사전 파일 및 배포 절차 정의
- [ ] 임베딩 생성 파이프라인(배치) 설계
- [ ] 검색 품질 테스트셋(대표 질의 100~300개) 구축
- [ ] 검색 이벤트 수집 스키마/저장소 결정

---

## 14. 비범위 (v0.1)

- 완전 자동 LTR 파이프라인 구축
- 다국어(한국어 외) 정교 튜닝
- 리뷰 문장 단위 aspect extraction 고도화

해당 항목은 본 초안의 후속 버전에서 단계적으로 다룬다.
