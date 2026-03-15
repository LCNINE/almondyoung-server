'use client'

import { createContext, useContext, type ReactNode } from 'react'

type FilterContextValue = {
  prefix?: string
  removeFilter: (key: string) => void
  removeAllFilters: (keys: string[]) => void
}

const FilterContext = createContext<FilterContextValue | null>(null)

export function FilterProvider({
  children,
  prefix,
  removeFilter,
  removeAllFilters,
}: {
  children: ReactNode
  prefix?: string
  removeFilter: (key: string) => void
  removeAllFilters: (keys: string[]) => void
}) {
  return (
    <FilterContext.Provider value={{ prefix, removeFilter, removeAllFilters }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useFilterContext() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilterContext must be used within FilterProvider')
  return ctx
}
