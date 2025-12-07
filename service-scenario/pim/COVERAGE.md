# PIM Category API Test Coverage

## 시나리오 요약

총 **20개의 테스트 시나리오**가 작성되었으며, **16개의 Category API 엔드포인트** 전체를 커버합니다.

## 엔드포인트 커버리지

| # | Method | Endpoint | 사용 시나리오 | 커버리지 |
|---|--------|----------|-------------|---------|
| 1 | POST | `/categories` | CAT-001, CAT-002, CAT-003, CAT-004, CAT-005, CAT-006, CAT-007, CAT-008, CAT-009, CAT-010, CAT-011, CAT-012, CAT-013, CAT-014, CAT-015, CAT-016, CAT-019, CAT-020 | ✅ (18개 시나리오) |
| 2 | PUT | `/categories/:id` | CAT-001 | ✅ |
| 3 | DELETE | `/categories/:id` | CAT-001, CAT-007, CAT-018 | ✅ (3개 시나리오) |
| 4 | GET | `/categories/:id` | CAT-001, CAT-002, CAT-008, CAT-009, CAT-010, CAT-011, CAT-019 | ✅ (7개 시나리오) |
| 5 | GET | `/categories` | CAT-002, CAT-004, CAT-020 | ✅ (3개 시나리오) |
| 6 | GET | `/categories/:id/children` | CAT-002, CAT-019 | ✅ (2개 시나리오) |
| 7 | GET | `/categories/:id/path` | CAT-002, CAT-019 | ✅ (2개 시나리오) |
| 8 | PUT | `/categories/:id/move` | CAT-003, CAT-017, CAT-020 | ✅ (3개 시나리오) |
| 9 | PUT | `/categories/:id/products` | CAT-005, CAT-020 | ✅ (2개 시나리오) |
| 10 | POST | `/categories/:id/products/add` | CAT-006, CAT-007, CAT-019 | ✅ (3개 시나리오) |
| 11 | PATCH | `/categories/:id/display-settings` | CAT-008, CAT-019 | ✅ (2개 시나리오) |
| 12 | PATCH | `/categories/:id/seo` | CAT-009, CAT-019 | ✅ (2개 시나리오) |
| 13 | PATCH | `/categories/:id/template` | CAT-010, CAT-019 | ✅ (2개 시나리오) |
| 14 | PATCH | `/categories/:id/visibility` | CAT-011, CAT-019 | ✅ (2개 시나리오) |
| 15 | PUT | `/categories/:categoryId/tag-groups` | CAT-012, CAT-013, CAT-014, CAT-019 | ✅ (4개 시나리오) |
| 16 | GET | `/categories/:categoryId/tag-groups` | CAT-012, CAT-013, CAT-019 | ✅ (3개 시나리오) |

**결과: 16개 엔드포인트 모두 커버됨 ✅**

---

## 시나리오 그룹별 분류

### Group 1: Basic CRUD Operations (1개)
- **CAT-001**: 기본 카테고리 생성 → 조회 → 수정 → 삭제
  - Coverage: POST, GET, PUT, DELETE, 404 에러

### Group 2: Hierarchical Structure (3개)
- **CAT-002**: 부모-자식 카테고리 계층 구조
  - Coverage: POST, GET tree, GET children, GET path
- **CAT-003**: 카테고리 이동 (Move)
  - Coverage: PUT move
- **CAT-004**: 다단계 계층 생성 및 조회
  - Coverage: GET tree with maxDepth

### Group 3: Product Association (3개)
- **CAT-005**: 상품 카테고리 이동 (Move Products)
  - Coverage: PUT products (replace)
- **CAT-006**: 상품 카테고리 추가 (Add Products)
  - Coverage: POST products/add (multi-category)
- **CAT-007**: 카테고리 삭제 시 상품 이동
  - Coverage: DELETE with moveProductsTo

### Group 4: Configuration Updates (4개)
- **CAT-008**: 카테고리 표시 설정
  - Coverage: PATCH display-settings
- **CAT-009**: 카테고리 SEO 설정
  - Coverage: PATCH seo
- **CAT-010**: 카테고리 템플릿 설정
  - Coverage: PATCH template
- **CAT-011**: 카테고리 표시 여부
  - Coverage: PATCH visibility

### Group 5: Tag Group Management (3개)
- **CAT-012**: 카테고리 태그 그룹 연결
  - Coverage: PUT tag-groups, GET tag-groups
- **CAT-013**: 태그 그룹 상속
  - Coverage: appliesToDescendants 플래그 및 상속 확인
- **CAT-014**: 태그 그룹 교체
  - Coverage: PUT replace 동작

### Group 6: Error Cases (4개)
- **CAT-015**: 중복 Slug 생성 시도 → 409 Conflict
- **CAT-016**: 존재하지 않는 부모 참조 → 404 Not Found
- **CAT-017**: 순환 참조 방지 → 400 Bad Request
- **CAT-018**: 자식이 있는 카테고리 삭제 시도 → 400 Bad Request

### Group 7: Complex Workflows (2개)
- **CAT-019**: 전체 카테고리 설정 워크플로우
  - Coverage: 모든 PATCH 엔드포인트 + GET 엔드포인트 종합
- **CAT-020**: 카테고리 재구성 (Reorganization)
  - Coverage: 복잡한 계층 재구성 및 상품 이동

---

## 의존성 API (Prerequisites)

각 시나리오는 독립적으로 실행 가능하도록 필요한 선행 데이터를 자체 생성합니다:

### Product Masters API
- `POST /masters` - 상품 마스터 생성 (body 없음)
- `PATCH /masters/:masterId/versions/:versionId/publish` - 버전 Publish

**사용 시나리오**: CAT-005, CAT-006, CAT-007, CAT-019, CAT-020

### Tags API
- `POST /tags/groups` - 태그 그룹 생성

**사용 시나리오**: CAT-012, CAT-013, CAT-014, CAT-019

---

## 검증 수준

**중간 (주요 필드만)** 수준의 응답 검증을 적용:
- 핵심 필드 3-5개만 Zod 스키마로 검증
- 검증 대상: `id`, `name`, `slug`, `isActive`, `level`, `parentId` 등
- 타임스탬프, 전체 JSONB 구조 등은 제외

### 검증 예시
```typescript
responseSchema: z.object({
  id: z.string().uuid(),
  name: z.literal('Test Category'),
  slug: z.string(),
  isActive: z.boolean(),
})
```

---

## 실행 방법

1. 시나리오 파일 위치: `/home/pauseb/workspace/almondyoung-server/service-scenario/pim/category.ts`
2. 각 시나리오는 독립적으로 실행 가능
3. `{{timestamp}}` 변수로 고유성 보장
4. Context 변수를 통한 스텝 간 데이터 전달

---

## 테스트 포인트 요약

- ✅ 기본 CRUD 동작
- ✅ 계층 구조 생성 및 관리
- ✅ 카테고리 이동 및 재구성
- ✅ 상품 연결 (Move vs Add 차이)
- ✅ 표시/SEO/템플릿/Visibility 설정
- ✅ 태그 그룹 연결 및 상속
- ✅ 에러 케이스 (409, 404, 400)
- ✅ 복잡한 워크플로우

**총 스텝 수**: 약 140+ 스텝
**총 시나리오 수**: 20개
**엔드포인트 커버리지**: 16/16 (100%)
