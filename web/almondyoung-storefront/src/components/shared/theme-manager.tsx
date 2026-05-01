"use client"

import React, { useState } from "react"
import { useCustomTheme } from "@lib/providers/custom-theme-provider"
import { Button } from "@/components/ui/button"
import { Settings, X } from "lucide-react"

export function ThemeManager() {
  // 개발 모드에서만 표시
  if (process.env.NODE_ENV !== "development") {
    return null
  }

  const { theme, setTheme, isSpecialTheme } = useCustomTheme()
  const [isOpen, setIsOpen] = useState(false)

  const themes = [
    {
      id: "light",
      name: "라이트",
      color: "bg-gray-100",
      textColor: "text-gray-800",
    },
    {
      id: "black-friday",
      name: "블랙프라이데이",
      color: "bg-black",
      textColor: "text-white",
    },
    {
      id: "valentine",
      name: "발렌타인",
      color: "bg-pink-100",
      textColor: "text-pink-800",
    },
    {
      id: "christmas",
      name: "크리스마스",
      color: "bg-green-100",
      textColor: "text-green-800",
    },
  ] as const

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed right-4 bottom-4 z-50 h-12 w-12 rounded-full shadow-lg"
        size="icon"
      >
        <Settings className="h-5 w-5" />
      </Button>
    )
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
          테마 변경
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(false)}
          className="h-6 w-6 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        {themes.map((themeOption) => (
          <Button
            key={themeOption.id}
            variant={theme === themeOption.id ? "default" : "outline"}
            size="sm"
            onClick={() => setTheme(themeOption.id as any)}
            className={`w-full justify-start ${themeOption.color} ${themeOption.textColor} ${
              theme === themeOption.id
                ? "ring-2 ring-[var(--color-primary)]"
                : ""
            }`}
          >
            <div
              className={`mr-2 h-3 w-3 rounded-full ${themeOption.color} border border-current`}
            />
            {themeOption.name}
            {isSpecialTheme && theme === themeOption.id && (
              <span className="ml-auto text-xs font-medium">특별 테마</span>
            )}
          </Button>
        ))}
      </div>

      <div className="mt-3 text-xs text-[var(--color-muted-foreground)]">
        현재 테마:{" "}
        <span className="font-medium">
          {themes.find((t) => t.id === theme)?.name}
        </span>
      </div>
    </div>
  )
}
