"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

interface SearchHistoryStore {
  keywords: string[]
  addKeyword: (text: string) => void
  removeKeyword: (text: string) => void
  clearAll: () => void
  disableSave: boolean
  setDisableSave: (disable: boolean) => void
}

export const useSearchHistory = create<SearchHistoryStore>()(
  persist(
    (set, get) => ({
      keywords: [],
      disableSave: false,
      setDisableSave: (disable: boolean) => set({ disableSave: disable }), // 검색어 저장 안하기

      addKeyword: (text: string) => {
        if (!text.trim() || get().disableSave) return

        set((state) => {
          // 이미 있으면 지우고 맨 앞으로 보냄 (최신순)
          const filtered = state.keywords.filter((k) => k !== text)
          const next = [text, ...filtered].slice(0, 10) // 최대 10개만 저장
          return { keywords: next }
        })
      },

      removeKeyword: (text: string) => {
        set((state) => {
          const next = state.keywords.filter((k) => k !== text)
          return { keywords: next }
        })
      },

      clearAll: () => {
        set({ keywords: [] })
      },
    }),
    {
      name: "search-history", // localStorage key
    }
  )
)
