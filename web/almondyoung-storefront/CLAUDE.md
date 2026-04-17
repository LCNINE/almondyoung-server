# CLAUDE.md - 아몬드영 스토어프론트

이 문서는 Claude Code가 이 프로젝트에서 작업할 때 참고하는 가이드라인입니다.

## 프로젝트 개요

- **프로젝트명**: 아몬드영 스토어프론트 (medusa-next)
- **타입**: Next.js 15 기반 이커머스 프론트엔드
- **백엔드**: Medusa V2
- **패키지 매니저**: yarn (npm 사용 금지)

## 기술 스택

- **프레임워크**: Next.js 15 (App Router, Turbopack)
- **언어**: TypeScript (strict mode)
- **스타일링**: Tailwind CSS v4
- **UI 라이브러리**: shadcn/ui (Radix UI 기반)
- **상태 관리**: Next.js fetch tags (우선), 필요시 Zustand
- **폼 처리**: React Hook Form + Zod
- **결제**: 토스페이먼츠
- **애니메이션**: Framer Motion

## 자주 사용하는 명령어

```bash
# 개발 서버 실행 (포트 8000)
yarn dev

# 프로덕션 빌드
yarn build

# 프로덕션 서버 실행
yarn start

# 린트 검사
yarn lint

# shadcn/ui 컴포넌트 추가
npx shadcn@latest add [component-name]
```

## 폴더 구조

```
src/
├── app/                    # Next.js App Router 페이지
│   └── [countryCode]/      # 국가 코드 기반 라우팅
│       ├── (auth)/         # 인증 관련 페이지
│       ├── (main)/         # 메인 페이지 (홈, 카테고리, 상품)
│       └── (mypage)/       # 마이페이지
├── components/             # 공통 컴포넌트
│   └── ui/                 # shadcn/ui 컴포넌트
├── domains/                # 도메인별 비즈니스 로직
│   ├── auth/               # 인증 (로그인, 회원가입)
│   ├── products/           # 상품
│   ├── order/              # 주문
│   ├── reviews/            # 리뷰
│   ├── payment/            # 결제
│   └── membership/         # 멤버십
├── lib/                    # 유틸리티, API 클라이언트
│   ├── api/                # API 호출 함수
│   ├── types/              # 전역 타입 정의
│   └── utils/              # 유틸리티 함수
├── hooks/                  # 전역 커스텀 훅
└── contexts/               # React Context
```

## 타입 정의 정책 (dto vs ui)

타입은 **레이어별로 분리**하여 관리합니다.

```
src/lib/types/
├── dto/          # API 응답/요청의 정확한 형태 (서버 DTO 미러링)
├── ui/           # dto를 확장한 프레젠테이션 타입
└── common/       # 공통 타입 (필터, 페이지네이션 등)
```

### 사용 규칙

| 레이어 | 사용할 타입 | 예시 |
|--------|------------|------|
| **API 함수** (`lib/api/`) | `dto` | `api<ReviewResponseDto>(...)` |
| **Server Action** | `dto` (입력) / `ui` (반환) | 변환 지점 |
| **SSR 페이지** (`page.tsx`) | `ui` | `const data: ReviewDetail = ...` |
| **컴포넌트** | `ui` | `props: { review: ReviewDetail }` |

### dto 타입 (`@/lib/types/dto/`)

- 서버 API 응답/요청의 **정확한 형태**를 정의
- `*ResponseDto`, `*Dto` 네이밍
- **오직 `lib/api/` 내 API 함수에서만 import**
- 컴포넌트, 페이지에서 직접 import 금지

### ui 타입 (`@/lib/types/ui/`)

- dto를 `extends`하여 프레젠테이션용 타입 정의
- UI 친화적 네이밍 (Dto 접미사 제거)
- **페이지, 컴포넌트, hooks에서 사용**
- 나중에 UI 전용 computed 필드 추가 가능

```tsx
// dto: 서버 응답 그대로
interface ReviewResponseDto {
  id: string
  rating: number
  // ...
}

// ui: dto 확장 (현재는 alias, 필요시 필드 추가)
interface ReviewDetail extends ReviewResponseDto {}
```

```tsx
// ✅ 올바른 사용
// lib/api/ugc/reviews.ts (API 함수)
import type { ReviewResponseDto } from "@/lib/types/dto/ugc"

// components/reviews/review-card.tsx (컴포넌트)
import type { ReviewDetail } from "@/lib/types/ui/ugc"

// ❌ 잘못된 사용
// components/reviews/review-card.tsx (컴포넌트에서 dto 직접 import)
import type { ReviewResponseDto } from "@/lib/types/dto/ugc" // 금지!
```

### Request DTO는 dto에만 존재

`Create*Dto`, `Update*Dto`, `*QueryDto` 등 요청용 타입은 API 호출에서만 사용하므로 ui 타입을 만들지 않습니다.

## 핵심 규칙

### 1. 파일/폴더 명명 규칙

- **모든 파일과 폴더**: `kebab-case` 사용
- PascalCase, camelCase 파일명 금지

```bash
# 올바른 예
src/components/product-card/index.tsx
src/domains/auth/hooks/use-auth-storage.ts

# 잘못된 예
src/components/ProductCard/index.tsx
src/domains/auth/hooks/useAuthStorage.ts
```

### 2. UI 컴포넌트 규칙

- **shadcn/ui 기본 컴포넌트 최대한 활용**
- MedusaUI (`@medusajs/ui`) 절대 사용 금지
- **shadcn/ui 컴포넌트 소스(`@/components/ui/`)의 CSS를 직접 수정하지 마세요**
  - 커스텀 스타일이 필요하면 Tailwind 클래스를 props로 전달하거나 래퍼 컴포넌트를 만드세요
  - `variants`를 추가해야 한다면 래퍼 컴포넌트에서 확장하세요

```tsx
// 올바른 임포트
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

// 잘못된 임포트
import { Button } from "@medusajs/ui" // 금지!
```

```tsx
// ✅ 올바른 스타일 확장 - className props 사용
<Button className="my-custom-class">Click</Button>

// ✅ 올바른 스타일 확장 - 래퍼 컴포넌트 생성
// @/components/shared/custom-button.tsx
export function CustomButton(props) {
  return <Button {...props} className={cn("custom-styles", props.className)} />
}

// ❌ 잘못된 방법 - @/components/ui/button.tsx 직접 수정 금지!
```

### 2-1. Link 컴포넌트 규칙

- **내부 링크는 반드시 `LocalizedClientLink` 사용**
- Next.js의 `Link`를 직접 사용하지 마세요 (국가 코드 라우팅 처리가 필요)

```tsx
// ✅ 올바른 사용
import LocalizedClientLink from "@/components/shared/localized-client-link"

<LocalizedClientLink href="/products">상품 목록</LocalizedClientLink>

// ❌ 잘못된 사용
import Link from "next/link"
<Link href="/products">상품 목록</Link> // 국가 코드 처리 안됨!
```

### 3. 도메인 구조 (캐시 지역성 원칙)

- 함께 수정되는 파일을 같은 폴더에 배치
- 기능 단위로 폴더 구성

```
domains/{domain}/{feature}/
├── components/     # UI 컴포넌트
├── hooks/          # 커스텀 훅 (필요시)
├── types/          # 타입 정의 (필요시)
├── schemas/        # Zod 스키마 (필요시)
└── templates/      # 페이지 템플릿 (필요시)
```

### 4. 컴포넌트 작성 규칙

```tsx
// 1. imports
import { useState } from "react"
import { Button } from "@/components/ui/button"

// 2. types
interface ProductCardProps {
  product: Product
}

// 3. component
export default function ProductCard({ product }: ProductCardProps) {
  // hooks
  const [isLoading, setIsLoading] = useState(false)

  // handlers
  const handleClick = () => {
    // ...
  }

  // render
  return <div>{/* ... */}</div>
}
```

### 5. 서버 컴포넌트 우선

- 가능한 서버 컴포넌트 사용
- `"use client"` 지시문 최소화
- 클라이언트 컴포넌트는 필수인 경우만

### 6. API 호출 규칙

- **모든 백엔드 API 요청은 `api()` 함수를 사용** (`src/lib/api/api.ts`)
- `fetch()`를 직접 호출하지 마세요. `api()` 함수가 인증, 에러 처리, JSON 파싱을 모두 처리합니다.

```tsx
import { api } from "@/lib/api/api"

// 기본 사용법: api<응답타입>(서비스명, 경로, 옵션)
const products = await api<ProductDto[]>("pim", "/products", {
  method: "GET",
  next: { tags: ["products"] },
})
```

#### 서비스 타입 (`BackendService`)

사용 가능한 서비스: `"users"` | `"pim"` | `"medusa"` | `"membership"` | `"fs"` | `"wallet"` | `"wms"` | `"channelAdapter"` | `"notification"` | `"anly"` | `"ugc"`

#### 인증이 필요한 요청 (`withAuth`)

- `withAuth`는 **기본값이 `true`** (명시하지 않으면 인증 포함)
- 인증이 **필요 없는** 공개 API는 `withAuth: false`를 명시

```tsx
// 인증 필요 (기본값, withAuth 생략 가능)
const profile = await api<ProfileDto>("users", "/users/me", {
  method: "GET",
})

// 인증 필요 + 명시적 표기
const updatedProfile = await api<ProfileDto>("users", "/users/me", {
  method: "PATCH",
  body: profileData,
  withAuth: true,
})

// 인증 불필요 (공개 API) - 반드시 withAuth: false 명시
const publicProducts = await api<ProductDto[]>("pim", "/products/public", {
  method: "GET",
  withAuth: false,
})
```

#### 주요 옵션

```tsx
type RequestOptions = {
  method?: string          // HTTP 메서드
  body?: unknown           // 요청 바디 (자동 JSON 직렬화, FormData도 지원)
  params?: Record<string, string>  // URL 쿼리 파라미터
  withAuth?: boolean       // 인증 포함 여부 (기본값: true)
  next?: {
    revalidate?: number | false
    tags?: string[]        // Next.js 캐시 태그
  }
}
```

#### 에러 처리

`api()`는 실패 시 다음 에러를 던집니다:
- `ApiAuthError` (401): 인증 실패
- `HttpApiError` (403, 기타): HTTP 에러
- `ApiNetworkError`: 네트워크 에러

#### 인증이 필요한 mutation (POST/PATCH/DELETE)은 반드시 Server Action + `startTransition`으로 호출

클라이언트 이벤트 핸들러(`onClick` 등)에서 직접 `try-catch`로 감싸면 401 에러가 `error.tsx` Error Boundary로 전파되지 않습니다.
`error.tsx`가 401을 감지하여 토큰 복구(`restore-token`)를 처리하므로, **인증이 필요한 API 호출은 Server Action(`"use server"`)으로 만들고 클라이언트에서 `startTransition`으로 호출**해야 합니다. UNAUTHORIZED 에러는 catch하지 않고 re-throw하여 `error.tsx`로 전파시킵니다.

```tsx
// 클라이언트 컴포넌트에서 Server Action 호출 패턴
import { useTransition } from "react"

const [isPending, startTransition] = useTransition()

const handleSubmit = () => {
  startTransition(async () => {
    try {
      await someServerAction(data)
    } catch (error: unknown) {
      const err = error as Error & { digest?: string }
      // UNAUTHORIZED는 re-throw → error.tsx에서 토큰 복구 처리
      if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
        throw error
      }
      // 그 외 에러만 UI에서 처리
      toast.error("실패했습니다. 다시 시도해주세요.")
    }
  })
}
```

### 7. 상태 관리 (fetch tags 우선)

- **서버 상태**: `api()` 함수의 `next.tags` + `revalidateTag()` 사용
- **클라이언트 상태**: 최소한으로, 필요시 Zustand 사용

```tsx
// 데이터 페칭 with tags (api 함수 사용)
const data = await api<ProductDto[]>("pim", "/products", {
  next: { tags: ["products"] },
})

// 캐시 무효화
import { revalidateTag } from "next/cache"
revalidateTag("products")
```

### 8. 스타일링

- Tailwind CSS 유틸리티 클래스 사용
- 인라인 style 지양
- `cn()` 유틸리티로 조건부 클래스 관리

```tsx
import { cn } from "@/lib/utils"
;<div className={cn("flex items-center", isActive && "bg-primary")} />
```

### 9. 폼 처리

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form"
```

### 10. 날짜 포맷팅

- **날짜를 사람이 읽는 문자열로 변환할 때는 반드시 `formatDate` 유틸을 사용하세요** (`@/lib/utils/format-date`)
- `new Date().toLocaleDateString(...)`, `Intl.DateTimeFormat(...)`, `date-fns`의 `format()` 직접 호출 금지
- `parseISO` + `format` 조합 등 파싱/포맷 로직을 컴포넌트마다 재작성하지 마세요

```tsx
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

// 기본: "2024년 6월 14일"
formatDate(order.createdAt)

// 프리셋 사용: "2024.06.14"
formatDate(order.createdAt, DATE_FORMATS.KO_DOT)

// 커스텀 패턴 (date-fns 토큰)
formatDate(order.createdAt, "yyyy/MM/dd HH:mm")

// 유효하지 않은 값의 기본 fallback은 "-" (빈 문자열 등으로 오버라이드 가능)
formatDate(maybeNull, DATE_FORMATS.KO_LONG, "")
```

- 지원 입력: `string | number | Date | null | undefined` (ISO 문자열/타임스탬프/Date 모두 허용)
- 공용 프리셋(`DATE_FORMATS`): `KO_LONG`, `KO_DOT`, `ISO_DATE`, `KO_DOT_TIME`, `KO_LONG_WEEKDAY` — 필요한 프리셋이 없다면 `DATE_FORMATS`에 추가한 뒤 사용하세요

## 경로 Alias

```typescript
"@/*"           → "src/*"
"@components/*" → "src/components/*"
"@lib/*"        → "src/lib/*"
"@hooks/*"      → "src/hooks/*"
"domains/*"     → "src/domains/*"
```

## 성능 최적화 규칙

> 상세 규칙은 Vercel React Best Practices 기반 (`.cursorrules` 참고)

### Bundle Size

- 동적 임포트 사용 (`next/dynamic`)
- named import로 tree-shaking 보장
- 큰 라이브러리 주의: `lodash`, `date-fns`, `lucide-react`

### 비동기 처리

```tsx
// 병렬 실행 가능한 작업은 Promise.all 사용
const [user, posts] = await Promise.all([fetchUser(), fetchPosts()])

// Early return으로 불필요한 작업 방지
if (skip) return { skipped: true }
```

### 루프 최적화

```tsx
// O(n²) 대신 Map 활용으로 O(n)
const reviewsMap = new Map(reviews.map((r) => [r.productId, r]))
products.map((product) => ({
  ...product,
  review: reviewsMap.get(product.id),
}))
```

## 주의사항

1. **shadcn/ui 컴포넌트 소스**(`@/components/ui/`)를 직접 수정하지 마세요. CSS 변경도 금지! 래퍼 컴포넌트를 만드세요.
2. **MedusaUI**를 사용하지 마세요. 항상 shadcn/ui를 사용하세요.
3. **npm**을 사용하지 마세요. yarn만 사용합니다.
4. **`fetch()`를 직접 호출하지 마세요.** 백엔드 API 요청은 반드시 `api()` 함수(`@/lib/api/api`)를 사용합니다.
5. **`next/link`의 `Link`를 직접 사용하지 마세요.** 내부 링크는 반드시 `LocalizedClientLink`(`@/components/shared/localized-client-link`)를 사용합니다.
6. **날짜 포맷팅 시 `toLocaleDateString`, `Intl.DateTimeFormat`, `date-fns`의 `format()`을 직접 호출하지 마세요.** 반드시 `formatDate`(`@/lib/utils/format-date`)를 사용합니다.

## 참고 문서

- `/.cursorrules` - Cursor 에디터 규칙 (동일 규칙 적용)
