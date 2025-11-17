# serverApi 사용 가이드

## 개요

`serverApi`는 서버 컴포넌트에서 백엔드 API를 호출하기 위한 유틸리티 함수입니다.

## 기본 사용법

```typescript
import { serverApi } from "@lib/api/server-api"

// 기본 사용 (body.data 자동 추출)
const data = await serverApi<UserDetail>("/api/users/detail")
```

## 응답 처리

### 기본 동작 (unwrapData: true)

API 응답이 다음과 같을 때:
```json
{
  "success": true,
  "data": { "id": "123", "name": "John" },
  "meta": { ... }
}
```

`serverApi`는 자동으로 `data` 부분만 추출해서 반환합니다:
```typescript
const user = await serverApi<UserDetail>("/api/users/detail")
// user = { "id": "123", "name": "John" }
```

### 전체 응답 받기 (unwrapData: false)

전체 응답 객체가 필요한 경우:
```typescript
const response = await serverApi<ApiResponse>("/api/users/detail", {
  unwrapData: false
})
// response = { success: true, data: {...}, meta: {...} }
```

## 타입 안전성

제네릭을 사용하여 타입 안전성을 보장합니다:

```typescript
interface User {
  id: string
  name: string
}

// ✅ 타입 안전
const user = await serverApi<User>("/api/users/detail")
// user.id, user.name 자동완성 가능

// ✅ 배열도 가능
const users = await serverApi<User[]>("/api/users")
```

## 에러 처리

```typescript
try {
  const data = await serverApi("/api/users/detail")
} catch (error) {
  if (error instanceof ApiAuthError) {
    // 401 인증 에러
  } else if (error instanceof ApiError) {
    // 기타 API 에러
    console.error(error.message, error.statusCode)
  } else if (error instanceof ApiNetworkError) {
    // 네트워크 에러
  }
}
```

## 옵션

```typescript
interface ServerApiOptions extends RequestInit {
  unwrapData?: boolean  // 기본값: true
}
```

### 예시

```typescript
// POST 요청
await serverApi("/api/users", {
  method: "POST",
  body: JSON.stringify({ name: "John" })
})

// 전체 응답 받기
await serverApi("/api/users", {
  unwrapData: false
})

// 커스텀 헤더
await serverApi("/api/users", {
  headers: {
    "X-Custom-Header": "value"
  }
})

// 타임아웃 설정
await serverApi("/api/users", {
  signal: AbortSignal.timeout(5000)
})
```

## 주의사항

1. **서버 컴포넌트 전용**: 클라이언트 컴포넌트에서는 `clientApi` 사용
2. **쿠키 자동 포함**: 인증 쿠키가 자동으로 포함됨
3. **타임아웃**: 기본 35초 타임아웃 설정됨
4. **절대 URL 필요**: 서버 사이드에서는 상대 경로 사용 불가

## 마이그레이션

기존 코드를 수정할 필요는 없습니다. `unwrapData`의 기본값이 `true`이므로 기존 동작과 동일합니다.

만약 전체 응답이 필요한 경우에만 `unwrapData: false` 옵션을 추가하세요.
