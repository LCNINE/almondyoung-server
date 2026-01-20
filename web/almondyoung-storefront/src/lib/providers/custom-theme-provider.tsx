"use client"

import React, { createContext, useContext, useState, useEffect } from "react"

export type ThemeType = "light" | "black-friday" | "valentine" | "christmas"

interface CustomThemeContextType {
  theme: ThemeType
  setTheme: (theme: ThemeType) => void
  isSpecialTheme: boolean
}

const CustomThemeContext = createContext<CustomThemeContextType | undefined>(
  undefined
)

export function CustomThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<ThemeType>("light")

  // 특별 테마인지 확인
  const isSpecialTheme = theme !== "light"

  // 초기 테마 로드 (로컬 스토리지에서)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("custom-theme") as ThemeType
      if (
        savedTheme &&
        ["light", "black-friday", "valentine", "christmas"].includes(savedTheme)
      ) {
        setTheme(savedTheme)
      }
    }
  }, [])

  // 테마 변경 시 body 클래스 업데이트
  useEffect(() => {
    if (typeof window === "undefined") return

    // 기존 테마 클래스 제거
    document.body.classList.remove(
      "light",
      "black-friday",
      "valentine",
      "christmas"
    )

    // 새 테마 클래스 추가
    document.body.classList.add(theme)

    // HTML 요소에도 클래스 추가 (CSS 변수 적용을 위해)
    document.documentElement.classList.remove(
      "light",
      "black-friday",
      "valentine",
      "christmas"
    )
    document.documentElement.classList.add(theme)

    // 로컬 스토리지에 저장
    localStorage.setItem("custom-theme", theme)
  }, [theme])

  return (
    <CustomThemeContext.Provider value={{ theme, setTheme, isSpecialTheme }}>
      {children}
    </CustomThemeContext.Provider>
  )
}

export function useCustomTheme() {
  const context = useContext(CustomThemeContext)
  if (context === undefined) {
    throw new Error("useCustomTheme must be used within a CustomThemeProvider")
  }
  return context
}
