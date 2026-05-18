# 카테고리 삭제 정책: 자식 차단, 매핑은 명시 처리

상품 카테고리(`productCategories`)는 고객 노출용 분류 트리다(CONTEXT.md 참조). 삭제는 비가역이고 메뉴 누락·딥링크 404·SEO 영향이 크므로 정책을 한 곳에 못 박는다.

## Decision

- **자식 카테고리가 존재하면 삭제를 차단한다** (백엔드 `BadRequestError`, admin UI 는 삭제 버튼 disabled + 사유 툴팁). 자식의 운명은 운영자가 명시적으로 정한 뒤(이동 또는 삭제) 본 노드를 정리한다. 자식을 부모로 자동 승격시키는 동작은 트리 모양을 의도와 어긋나게 바꾸므로 채택하지 않는다.
- **매핑된 상품(`productMasterCategories`)이 있어도 삭제는 허용하되, admin UI 의 confirm 단계에서 결과를 명시한다.** 두 갈래를 모두 노출한다:
  1. **다른 카테고리로 이전** — `DELETE /categories/:id?moveProductsTo=<targetId>` 호출. 백엔드가 매핑을 일괄 update.
  2. **매핑만 끊기** — 파라미터 없이 호출. 상품은 살지만 이 카테고리 태깅만 제거.
- 일상적인 "안 보이게" 작업은 hard delete 가 아니라 `isActive=false` 토글이 정식 채널이다. 삭제는 진짜 정리 시점에만.

## Why this shape

매핑 있을 때도 차단으로 통일하는 안(원안)도 검토했으나, 백엔드가 이미 `moveProductsTo` 라는 도메인적으로 유용한 능력을 제공하고 있고, 카테고리 통폐합·시즌 종료 시 "이 카테고리의 상품을 저쪽으로 옮기고 폐기" 가 흔한 운영 시나리오다. 위험의 본질은 "결과를 모르고 누름" 이므로 차단 대신 confirm 단계에서 N개 상품의 처리를 명시하는 방식으로 통제한다. 백엔드 정책을 변경하면 다른 호출자 정합성·인수 테스트 영향이 크다는 점도 고려했다.

## Consequences

- 백엔드 `categoriesService.deleteCategory(id, moveProductsTo?)` 시그니처를 변경하지 않는다. 정책은 그대로 유지.
- admin UI 의 삭제 confirm dialog 는 매핑 카운트를 prefetch 해서 (0건이면 단순 confirm, N건이면 라디오 두 갈래 + 이전 대상 셀렉터) 렌더링한다.
- "자식 차단" 은 백엔드 권위 — admin UI 의 disabled 처리는 UX 편의일 뿐, 진실은 서버 응답.
- 자식·매핑이 모두 있는 카테고리는 자식 차단이 먼저 걸리므로 매핑 옵션은 보이지 않는다.
