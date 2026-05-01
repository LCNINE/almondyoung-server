# 🚀 개발 가이드라인

> 아몬드영 클라이언트 개발 시 준수해야 할 규칙과 컨벤션

## 🚨 중요 규칙

### ⛔ 절대 하지 말아야 할 것

1. **MedusaUI 컴포넌트 임포트 금지**

   ```tsx
   // ❌ 절대 사용 금지
   import { Button } from "@medusajs/ui"

   // ✅ 반드시 shadcn/ui 사용
   import { Button } from "@/modules/common/components/ui/button"
   ```

2. **(demo) 폴더에서 직접 임포트 금지**

   ```tsx
   // ❌ 금지
   import Something from "../../(demo)/src/modules/..."

   // ✅ 참고만 하고 새로 작성
   // (demo) 폴더는 참고용입니다
   ```

## 📁 폴더 구조 규칙

### 컴포넌트 위치

- **공통 UI 컴포넌트**: `src/modules/common/components/ui/`
- **도메인별 컴포넌트**: `src/modules/[domain]/components/`
- **페이지 전용 컴포넌트**: 해당 페이지 `(components)` 폴더 (특수한 경우만)

### 예시

```
src/modules/
├── common/
│   └── components/
│       └── ui/           # shadcn/ui 컴포넌트
├── products/
│   ├── components/       # 상품 관련 컴포넌트
│   └── templates/        # 상품 페이지 템플릿
└── cart/
    ├── components/       # 장바구니 컴포넌트
    └── templates/        # 장바구니 템플릿
```

## 🎨 UI 컴포넌트 사용

### shadcn/ui 컴포넌트 추가

```bash
# 새로운 shadcn/ui 컴포넌트 추가 시
npx shadcn@latest add [component-name]

# 예시
npx shadcn@latest add button
npx shadcn@latest add card
```

### 컴포넌트 임포트 규칙

```tsx
// ✅ 올바른 임포트
import { Button } from "@/modules/common/components/ui/button"
import { Card } from "@/modules/common/components/ui/card"

// ✅ 도메인 컴포넌트
import ProductCard from "@/modules/products/components/product-card"
```

## 🔧 개발 팁

### Medusa SDK 사용

```tsx
// (demo)/src/lib/data/ 폴더 참고
// SDK 사용 패턴은 기존 코드 참고

import { getProducts } from "@/lib/data/products"
import { getCart } from "@/lib/data/cart"
```

### 서버 컴포넌트 우선

- 가능한 한 서버 컴포넌트 사용
- 클라이언트 컴포넌트는 반드시 필요한 경우만
- `"use client"` 지시문은 최소한으로

### 스타일링

```tsx
// Tailwind CSS + cn 유틸리티 사용
import { cn } from "@/lib/utils"
;<div className={cn("flex items-center", isActive && "bg-primary")} />
```

## 📝 코딩 컨벤션

### 파일 네이밍

> 메두사의 스타터 프론트를 사용하는 만큼, 메두사의 구조를 따릅니다. 메두사는 기본적으로 케밥케이스 형태입니다.

- 폴더 및 파일명 : `kebab-case` (예: `product-card/`)

### 컴포넌트 구조

```tsx
// 1. imports
import { useState } from "react"
import { Button } from "@/modules/common/components/ui/button"

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

## 🔍 참고 자료

### (demo) 폴더 활용

- **참고할 것**: 라우팅 구조, SDK 사용법, 데이터 페칭 패턴

## ⚡ 빠른 체크리스트

새 기능 개발 시:

- [ ] shadcn/ui 컴포넌트 사용했나요?
- [ ] MedusaUI 임포트는 없나요?
- [ ] 올바른 폴더 구조를 따랐나요?
- [ ] 서버 컴포넌트로 만들 수 있는데 클라이언트 컴포넌트로 만들지 않았나요?
- [ ] Tailwind CSS를 사용했나요?

---

> 💡 **Tip**: 확실하지 않을 때는 (demo) 폴더의 구조를 참고하되, UI는 새로 만드세요!
