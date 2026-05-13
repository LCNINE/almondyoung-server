# 도메인 API client 컨벤션

> `src/lib/api/domains/**` 아래 도메인 client 작성 시 따라야 하는 규칙입니다.

## 핵심 규칙

도메인 client 파일은 **단일 객체 export** 만 노출합니다.

```ts
// ✅ 권장
export const categoriesClient = {
  create: async (dto) => { ... },
  list: async () => { ... },
  // ...
};

// ❌ 금지: 객체 + 같은 엔드포인트의 개별 named function 동시 export
export const categoriesClient = { ... };
export const getCategoryTree = async () => { ... };

// ❌ 금지: 동일 엔드포인트의 alias 객체
export const categoriesClient = { ... };
export const categories = { getTree: categoriesClient.list, ... };
```

## 이름 규칙

- 객체 이름은 `<domain>Client` 형식 (예: `categoriesClient`, `skusClient`, `ordersClient`).
- 메서드 이름은 동사 또는 동사구 (`create`, `list`, `get`, `update`, `remove`, `move` 등). 한 파일 안에서는 일관된 어휘를 유지하세요 (예: 삭제는 `remove` 또는 `delete` 중 하나로 통일).

## 예외: 응답 타입 export

도메인 API 의 응답/요청 DTO 가 별도 `types/` 파일에 있지 않고 client 파일에 함께 정의된 경우, `export interface` / `export type` 으로 노출하는 것은 허용합니다. 단, 해당 타입의 이름과 정의 위치는 호출처에서 명시적으로 import 할 수 있는 형태여야 합니다.

## 이유

- 같은 엔드포인트가 여러 이름으로 노출되면 호출처마다 추측이 필요해지고, 검색/리팩토링이 어려워집니다.
- 단일 객체 형태는 `xxxClient.method` 패턴으로 grep 했을 때 호출처 전수를 즉시 파악할 수 있습니다.

## 새 도메인 추가 시 체크리스트

- [ ] `xxxClient` 단일 객체로만 export.
- [ ] `domains/index.ts` 에서 해당 객체만 re-export (개별 함수, alias 객체 금지).
- [ ] 호출처는 `xxxClient.method()` 형태로 사용.
