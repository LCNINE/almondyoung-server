# Next.js 15 헤더 관리 중앙화 전략 명세서

## 📋 개요

### 전략 요약

- **PC 헤더**: 블랙리스트 방식 (99% 페이지에서 보임 → 예외만 관리)
- **모바일 헤더**: 화이트리스트 방식 (글로벌 기본 → 서브 헤더 페이지만 명시)
- **위치**: RootLayout에서 중앙 관리
- **동적 라우트**: 자동 패턴 매칭 지원

---

---

## 🔧 1. 설정 파일 (config/layout.config.ts)

```typescript
// config/layout.config.ts

/**
 * 🚫 데스크톱 헤더 블랙리스트
 * 헤더가 나오지 않아야 하는 페이지만 명시
 */
export const desktopHeaderBlacklist: string[] = [
  "/login",
  "/signup",
  "/admin/print", // 예: 인쇄 전용 페이지
]

/**
 * 📱 모바일 서브 헤더 화이트리스트
 * 서브 헤더(뒤로가기 버튼)가 필요한 페이지와 제목 명시
 * Key: 경로 패턴 (동적 라우트는 [id] 형식)
 * Value: 헤더 제목
 */
export const mobileSubHeaders: Record<string, string> = {
  // 상품 관련
  "/products/[id]": "상품 상세",
  "/products/[id]/reviews": "상품 리뷰",
  "/products/[id]/qna": "상품 문의",

  // 마이페이지
  "/mypage/orders/[id]": "주문 상세",
  "/mypage/settings": "설정",
  "/mypage/addresses": "배송지 관리",
  "/mypage/payment-methods": "결제수단 관리",
  "/mypage/coupons": "쿠폰",
  "/mypage/points": "포인트",

  // 장바구니/결제
  "/cart/checkout": "주문/결제",
  "/cart/checkout/complete": "주문 완료",

  // 기타
  "/notifications": "알림",
  "/search/result": "검색 결과",
  "/customer-service": "고객센터",
  "/customer-service/faq": "자주 묻는 질문",
  "/customer-service/inquiry": "1:1 문의",
}

/**
 * 동적 라우트 패턴 매칭 함수
 * @example
 * matchesDynamicRoute('/products/[id]', '/products/123') // true
 * matchesDynamicRoute('/products/[id]/reviews', '/products/123/reviews') // true
 */
function matchesDynamicRoute(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split("/")
  const pathSegments = pathname.split("/")

  // 세그먼트 개수가 다르면 매칭 실패
  if (patternSegments.length !== pathSegments.length) {
    return false
  }

  // 각 세그먼트 비교
  return patternSegments.every((segment, i) => {
    // [id], [slug] 같은 동적 세그먼트는 무조건 매칭
    if (segment.startsWith("[") && segment.endsWith("]")) {
      return true
    }
    // 일반 세그먼트는 정확히 일치해야 함
    return segment === pathSegments[i]
  })
}

/**
 * 데스크톱 헤더 표시 여부 반환
 * @param pathname - 현재 페이지 경로
 * @returns 헤더를 표시해야 하면 true
 */
export function shouldShowDesktopHeader(pathname: string): boolean {
  return !desktopHeaderBlacklist.includes(pathname)
}

/**
 * 모바일 헤더 설정 반환
 * @param pathname - 현재 페이지 경로
 * @returns 헤더 타입과 제목 (서브 헤더인 경우)
 */
export function getMobileHeaderConfig(pathname: string): {
  type: "global" | "sub"
  title?: string
} {
  // 1. 정확히 일치하는 경로 우선 확인
  if (mobileSubHeaders[pathname]) {
    return {
      type: "sub",
      title: mobileSubHeaders[pathname],
    }
  }

  // 2. 동적 라우트 패턴 매칭
  for (const [pattern, title] of Object.entries(mobileSubHeaders)) {
    if (pattern.includes("[") && matchesDynamicRoute(pattern, pathname)) {
      return { type: "sub", title }
    }
  }

  // 3. 기본값: 글로벌 헤더
  return { type: "global" }
}
```

---

## 🎨 2. ConditionalHeader 컴포넌트

```tsx
// components/layout/conditional-header.tsx
"use client"

import { usePathname } from "next/navigation"
import {
  shouldShowDesktopHeader,
  getMobileHeaderConfig,
} from "@/config/layout.config"
import { DesktopHeader } from "./components/header/desktop-header"
import { MobileHeader } from "./components/header/m.main-header"
import SubPageHeader from "./components/header/subpage-header"
import { UserBasicInfo } from "@lib/types/ui/user"

interface ConditionalHeaderProps {
  user: UserBasicInfo | null | undefined
}

/**
 * 페이지별 헤더를 조건부로 렌더링하는 컴포넌트
 * - 데스크톱: 블랙리스트 기반으로 표시/숨김
 * - 모바일: 글로벌 또는 서브 헤더 선택
 */
export function ConditionalHeader({ user }: ConditionalHeaderProps) {
  const pathname = usePathname()

  // 설정 조회
  const showDesktopHeader = shouldShowDesktopHeader(pathname)
  const mobileConfig = getMobileHeaderConfig(pathname)

  return (
    <>
      {/* 데스크톱 헤더 - 블랙리스트에 없으면 표시 */}
      {showDesktopHeader && (
        <div className="hidden md:block">
          <DesktopHeader user={user} />
        </div>
      )}

      {/* 모바일 헤더 - 글로벌 또는 서브 */}
      <div className="block md:hidden">
        {mobileConfig.type === "global" ? (
          <MobileHeader
            user={user}
            showBack={false}
            showSearch={true}
            showCart={true}
          />
        ) : (
          <SubPageHeader title={mobileConfig.title!} />
        )}
      </div>

      {/* 메뉴 포탈 루트 */}
      <div id="menu-root" className="relative z-[150]" />
    </>
  )
}
```

---

## 🏗️ 3. RootLayout 통합

```tsx
// app/layout.tsx
import { ConditionalHeader } from "@components/layout/conditional-header"
import { CartQuickButton } from "@components/cart/mobile-cart-quickButton"
import { FloatingButtons } from "@components/common/custom-buttons/floating-buttons"
import { ConditionalFooter } from "@components/layout/components/conditional-footer"
import { fetchCurrentUser } from "@lib/api/users"
import { CategoryProvider } from "@lib/providers/category-provider"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { renderSchemaTags } from "@lib/seo"
import { getAllCategoriesCached } from "@lib/services/pim/category/getCategory"
import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { Toaster } from "sonner"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 병렬 로딩 + 에러 격리
  const [categoriesResult, userResult] = await Promise.allSettled([
    getAllCategoriesCached(),
    fetchCurrentUser().catch((err) => {
      if (err.message === "Network Error") {
        return null
      }
      throw err
    }),
  ])

  // Graceful Degradation
  const categories =
    categoriesResult.status === "fulfilled" ? categoriesResult.value : []

  const initialUser =
    userResult.status === "fulfilled" ? userResult.value : null

  // 개발 환경 로깅
  if (process.env.NODE_ENV === "development") {
    if (categoriesResult.status === "rejected") {
      console.warn("[RootLayout] 카테고리 로드 실패:", categoriesResult.reason)
    }
    if (userResult.status === "rejected") {
      console.warn("[RootLayout] 사용자 정보 로드 실패:", userResult.reason)
    }
  }

  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="overflow-x-clip [scrollbar-gutter:stable_both-edges]">
        <CategoryProvider initialCategories={categories}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            <CustomThemeProvider>
              {/* ✅ 헤더를 RootLayout으로 이동 */}
              <ConditionalHeader user={initialUser} />

              <div className="relative">
                {children}
                <CartQuickButton />
                <FloatingButtons />
              </div>
              <Toaster />
            </CustomThemeProvider>
          </ThemeProvider>
          <ConditionalFooter />
        </CategoryProvider>
        {renderSchemaTags()}
      </body>
    </html>
  )
}
```

---

## 🧹 4. MainLayout 정리

```tsx
// app/(main)/layout.tsx
import { ThemeToggle } from "@components/common/thema-toggle"
import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

/**
 * MainLayout - 헤더 로직 제거됨
 * 헤더는 RootLayout의 ConditionalHeader에서 통합 관리
 */
export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <ThemeToggle /> {/* 임시 */}
    </div>
  )
}
```

---

## 📊 5. 동작 예시

### PC 헤더 동작

| 경로            | 블랙리스트 포함? | 헤더 표시 |
| --------------- | ---------------- | --------- |
| `/`             | ❌               | ✅ 표시   |
| `/products`     | ❌               | ✅ 표시   |
| `/products/123` | ❌               | ✅ 표시   |
| `/login`        | ✅               | ❌ 숨김   |
| `/signup`       | ✅               | ❌ 숨김   |

### 모바일 헤더 동작

| 경로                 | 설정 존재? | 헤더 타입 | 제목        |
| -------------------- | ---------- | --------- | ----------- |
| `/`                  | ❌         | 글로벌    | -           |
| `/products`          | ❌         | 글로벌    | -           |
| `/products/123`      | ✅         | 서브      | "상품 상세" |
| `/mypage/orders/456` | ✅         | 서브      | "주문 상세" |
| `/cart/checkout`     | ✅         | 서브      | "주문/결제" |

---

## ✅ 장점

1. **효율적인 관리**
   - PC: 3-5개 예외만 관리
   - 모바일: 10-20개 서브 페이지만 관리

2. **동적 라우트 자동 지원**
   - `/products/123`, `/products/abc` 모두 자동 매칭
   - 패턴 등록 한 번으로 모든 ID 커버

3. **중앙화된 설정**
   - 한 파일(`layout.config.ts`)에서 모든 헤더 관리
   - 변경사항 추적 용이

4. **명확한 기본값**
   - PC: 기본 표시 (블랙리스트만 숨김)
   - 모바일: 기본 글로벌 (화이트리스트만 서브)

5. **확장 용이**
   - 새 페이지 추가 시 config만 수정
   - 컴포넌트 코드 변경 불필요

---

## 🚀 적용 순서

1. `config/layout.config.ts` 생성 및 설정 작성
2. `components/layout/conditional-header.tsx` 생성
3. `app/layout.tsx`에서 `ConditionalHeader` 추가
4. `app/(main)/layout.tsx`에서 헤더 관련 코드 제거
5. 기존 `ResponsiveHeader` props 정리 (showBack, showSearch 등 불필요)

---

## 📝 유지보수 가이드

### 새 페이지 추가 시

1. **PC에서 헤더 숨기고 싶으면**

   ```typescript
   // layout.config.ts
   export const desktopHeaderBlacklist = [
     "/login",
     "/your-new-page", // 추가
   ]
   ```

2. **모바일에서 서브 헤더 추가하고 싶으면**
   ```typescript
   // layout.config.ts
   export const mobileSubHeaders = {
     "/products/[id]": "상품 상세",
     "/your-new-page": "새 페이지 제목", // 추가
   }
   ```

### 동적 라우트 추가 시

```typescript
// 자동으로 매칭됨
'/products/[id]': '상품 상세'
// → /products/1, /products/abc, /products/hello 모두 적용

'/blog/[category]/[slug]': '블로그 글'
// → /blog/tech/nextjs, /blog/design/figma 모두 적용
```
