'use client'

import React, { useMemo } from 'react'
import { ChevronLeft } from 'lucide-react'
import { usePathname, useParams } from 'next/navigation'
import Link from 'next/link'
import { useCategories } from '@lib/providers/category-provider' // 새 Provider 훅
import type { PimCategory } from '@lib/types/dto/pim'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[]
  className?: string
  productName?: string
  /** 서버/서비스에서 내려준 카테고리 경로(있으면 최우선 사용) */
  categoryPath?: Array<{ id: string; name: string; slug?: string | null }>
}

/** 트리에서 조상 경로를 찾는 유틸 */
function buildAncestors(
  categories: PimCategory[],
  match: (c: PimCategory) => boolean
): PimCategory[] {
  const stack: PimCategory[] = []
  let found: PimCategory[] | null = null

  const dfs = (node: PimCategory) => {
    if (found) return
    stack.push(node)
    if (match(node)) {
      found = [...stack]
      stack.pop()
      return
    }
    for (const child of node.children ?? []) dfs(child)
    stack.pop()
  }

  for (const root of categories) dfs(root)
  return found ?? []
}

/** slug 또는 id로 카테고리 매치 */
const matchByAny = (token: string) => (c: PimCategory) =>
  c.id === token || c.slug === token || c.name?.toLowerCase() === token.toLowerCase()

export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  className = 'bg-white border-b border-gray-200',
  productName,
  categoryPath,
}) => {
  const pathname = usePathname()
  const params = useParams()
  const countryCode = Array.isArray(params?.countryCode)
    ? params.countryCode[0]
    : (params as any)?.countryCode ?? 'kr'

  const { categories } = useCategories()

  // 1) 수동 items가 있으면 최우선
  const manual = items && items.length > 0 ? items : null

  // 2) 상품 상세에서 서버가 내려준 categoryPath가 있으면 그걸 사용
  const serverPath = useMemo(() => {
    if (!categoryPath?.length) return null
    return categoryPath.map((c) => ({
      label: c.name,
      href: `/${countryCode}/c/${c.slug || c.id}`,
    }))
  }, [categoryPath, countryCode])

  // 3) URL 기반 자동 생성
  const auto = useMemo((): BreadcrumbItem[] => {
    const segs = pathname.split('/').filter(Boolean)
    // segs 예: ["kr","products","0199..."] | ["kr","c","0199..."] | ["kr","category","nail"]

    const list: BreadcrumbItem[] = [{ label: '홈', href: `/${countryCode}` }]

    // (A) 상품 상세: /:cc/products/:id
    if (segs[1] === 'products' && segs[2]) {
      if (serverPath) list.push(...serverPath)
      // serverPath가 없으면 currentCategory 추정 대신 URL에서 유추
      // (여기서는 안전하게 생략하고 상품명만 추가)
      if (productName) list.push({ label: productName, href: `/${countryCode}/products/${segs[2]}` })
      return list
    }

    // (B) 메인 카테고리: /:cc/category/:slug (새 구조)
    if (segs[1] === 'category' && segs[2] && segs[2] !== 'sub') {
      const slug = segs[2]
      
      // 서버 categoryPath 있으면 사용
      if (serverPath) {
        list.push(...serverPath)
        return list
      }
      
      // 카테고리 트리에서 해당 카테고리 찾기
      const findCategory = (cats: PimCategory[]): PimCategory | null => {
        for (const cat of cats) {
          if (cat.slug === slug || cat.id === slug) {
            return cat
          }
          if (cat.children?.length) {
            const found = findCategory(cat.children)
            if (found) return found
          }
        }
        return null
      }
      
      const category = findCategory(categories)
      if (category) {
        // 조상 경로 찾기
        const ancestors = buildAncestors(categories, (c) => c.id === category.id)
        for (const cat of ancestors) {
          list.push({ 
            label: cat.name, 
            href: `/${countryCode}/category/${cat.slug}` 
          })
        }
      }
      
      return list
    }

    // (C) 서브 카테고리: /:cc/category/sub/:id
    if (segs[1] === 'category' && segs[2] === 'sub' && segs[3]) {
      const token = segs[3]
      const ancestors = buildAncestors(categories, matchByAny(token))
      
      for (const cat of ancestors) {
        // 최상위 카테고리는 slug 경로로, 하위 카테고리는 sub 경로로
        if (cat.parentId === null) {
          list.push({ 
            label: cat.name, 
            href: `/${countryCode}/category/${cat.slug}` 
          })
        } else {
          list.push({ 
            label: cat.name, 
            href: `/${countryCode}/category/sub/${cat.id}` 
          })
        }
      }
      return list
    }

    // (D) 기타: 홈만
    return list
  }, [pathname, countryCode, categories, serverPath, productName])

  const finalItems = manual ?? auto

  return (
    <div className={className}>
      <div className="max-w-[1360px] mx-auto md:px-[40px] px-[15px] py-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          {finalItems.map((item, idx) => (
            <React.Fragment key={`${item.label}-${idx}`}>
              {idx > 0 && <ChevronLeft className="w-4 h-4 rotate-180" />}
              {item.href ? (
                <Link href={item.href} className="hover:text-gray-900 transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span>{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
