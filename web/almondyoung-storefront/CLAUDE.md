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

- **shadcn/ui 컴포넌트 우선 사용**
- MedusaUI (`@medusajs/ui`) 절대 사용 금지

```tsx
// 올바른 임포트
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

// 잘못된 임포트
import { Button } from "@medusajs/ui" // 금지!
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

### 6. 상태 관리 (fetch tags 우선)

- **서버 상태**: Next.js fetch의 `tags` + `revalidateTag()` 사용
- **클라이언트 상태**: 최소한으로, 필요시 Zustand 사용

```tsx
// 데이터 페칭 with tags
const data = await fetch(url, { next: { tags: ["products"] } })

// 캐시 무효화
import { revalidateTag } from "next/cache"
revalidateTag("products")
```

### 7. 스타일링

- Tailwind CSS 유틸리티 클래스 사용
- 인라인 style 지양
- `cn()` 유틸리티로 조건부 클래스 관리

```tsx
import { cn } from "@/lib/utils"
;<div className={cn("flex items-center", isActive && "bg-primary")} />
```

### 8. 폼 처리

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form"
```

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

1. **shadcn/ui 컴포넌트 소스**를 직접 수정하지 마세요. 래퍼 컴포넌트를 만드세요.
2. **MedusaUI**를 사용하지 마세요. 항상 shadcn/ui를 사용하세요.
3. **npm**을 사용하지 마세요. yarn만 사용합니다.

## 참고 문서

- `/.cursorrules` - Cursor 에디터 규칙 (동일 규칙 적용)
