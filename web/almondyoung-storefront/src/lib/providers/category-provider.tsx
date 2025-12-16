// src/lib/providers/category-provider.tsx
"use client"

import React, { createContext, useContext, useState } from "react"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
import { getAllCategoriesCached } from "@lib/services/pim/category/getCategoryService"

type Ctx = {
  categories: CategoryTreeNodeDto[]
  isRefreshing: boolean
  refresh: () => Promise<void>
}

const CategoryContext = createContext<Ctx | null>(null)

export const useCategories = () => {
  const ctx = useContext(CategoryContext)
  if (!ctx)
    throw new Error("useCategories must be used within CategoryProvider")
  return ctx
}

export function CategoryProvider({
  children,
  initialCategories,
}: {
  children: React.ReactNode
  initialCategories: CategoryTreeNodeDto[]
}) {
  const [categories, setCategories] = useState<CategoryTreeNodeDto[]>(
    initialCategories ?? []
  )
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = async () => {
    try {
      setIsRefreshing(true)
      const res = await getAllCategoriesCached()
      setCategories(res)
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <CategoryContext.Provider value={{ categories, isRefreshing, refresh }}>
      {children}
    </CategoryContext.Provider>
  )
}
