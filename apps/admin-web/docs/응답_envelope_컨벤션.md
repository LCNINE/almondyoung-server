# 응답 envelope 컨벤션

> `src/lib/api/domains/**` 아래 도메인 client 가 백엔드 응답을 다루는 규칙입니다.

## 핵심 규칙

도메인 client 함수는 **항상 unwrap 된 `T`** 를 반환합니다. envelope 처리는 호출처에서 다시 하지 않습니다.

```ts
// ✅ 권장: 반환 타입 = 실제 데이터 (T)
export const userApi = {
  getMe: async (): Promise<User> => {
    const response = await client.get<User>(`${USER_SERVICE_BASE_URL}/users/me`);
    return response.data;
  },
};

// ❌ 금지: 반환 타입에 envelope 노출
export const userApi = {
  getMe: async (): Promise<ApiResponse<User>> => {
    const response = await client.get(...);
    return response.data; // 호출처에서 .data 또 까야 함 — 책임 누수
  },
};

// ❌ 금지: 함수 안에서 .data.data 수동 unwrap
export const userApi = {
  getMe: async (): Promise<User> => {
    const response = await client.get(...);
    return response.data.data; // envelope auto-unwrap 인터셉터가 이미 처리함
  },
};
```

## 자동 unwrap 인터셉터

`src/lib/api/client.ts` 의 response interceptor 가 `{ success: true, data, message? }` 형태 응답을 자동으로 unwrap 합니다.

- user-service 처럼 `@app/shared` 의 `ResponseInterceptor` 로 envelope 를 씌우는 백엔드도, core 처럼 raw 응답을 보내는 백엔드도 도메인 client 입장에선 동일하게 보입니다.
- 따라서 도메인 client 는 항상 `response.data` 만 쓰면 됩니다.

## 새 API 추가 시 체크리스트

- [ ] 함수의 반환 타입은 **순수 도메인 타입** (`User`, `OrderDto[]` 등). `ApiResponse<T>` 직접 노출 금지.
- [ ] 함수 본문은 `return response.data;` 한 줄로 충분. `.data.data` 형태는 인터셉터 변경 신호이므로 즉시 의심.
- [ ] 호출처(`useQuery`, `useMutation`, 컴포넌트 등)에서 `data.data` 로 envelope 까는 코드가 없어야 함.

## 인증이 없는 health-check 등도 `client` 사용

별도의 raw `axios` 인스턴스를 만들지 말고 `client` 를 그대로 쓰세요. envelope auto-unwrap, retry, 에러 정규화 등 공통 처리가 자동으로 적용됩니다.
