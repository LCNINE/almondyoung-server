"use client"

import { useState } from "react"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { CategoryDropdownTrigger } from "./category-dropdown-trigger"
import { MegaMenu } from "./mega-menu"

interface CategoryDropdownProps {
  categories: StoreProductCategoryTree[]
  variant?: "header" | "quickLink" | "headerTile"
}

export function CategoryDropdown({
  categories,
  variant = "header",
}: CategoryDropdownProps) {
  const isQuickLink = variant === "quickLink"
  const isHeaderTile = variant === "headerTile"
  // 메뉴 영역을 벗어나면 즉시 닫히도록 값을 직접 제어.
  const [value, setValue] = useState("")

  return (
    <NavigationMenu
      value={value}
      onValueChange={setValue}
      delayDuration={0}
      skipDelayDuration={0}
      onPointerLeave={() => setValue("")}
      className={cn(
        "z-[100] [&_.origin-top-center]:z-[100] [&_.origin-top-center]:animate-none! [&_.origin-top-center]:rounded-none [&_.origin-top-center]:border-0 [&_.origin-top-center]:bg-transparent [&_.origin-top-center]:shadow-none [&_.origin-top-center]:duration-0 [&>div]:z-[100]",
        isHeaderTile
          ? "flex h-full w-full max-w-none items-stretch justify-stretch [&_.origin-top-center]:mt-0 [&>div:first-child]:h-full [&>div:first-child]:w-full"
          : isQuickLink
            ? "flex w-full max-w-none [&_.origin-top-center]:mt-12"
            : "hidden md:flex [&_.origin-top-center]:mt-0"
      )}
    >
      <NavigationMenuList
        className={cn(
          (isQuickLink || isHeaderTile) && "w-full flex-1 space-x-0",
          isHeaderTile && "h-full items-stretch"
        )}
      >
        <NavigationMenuItem
          value="category"
          className={cn(
            (isQuickLink || isHeaderTile) && "w-full",
            isHeaderTile && "h-full"
          )}
        >
          <NavigationMenuTrigger
            className={cn(
              "group/trigger cursor-pointer border border-transparent bg-transparent font-medium transition-colors [&>svg:last-child]:hidden",
              isQuickLink
                ? "flex h-auto w-full flex-col gap-2 rounded-lg px-0.5 py-1 text-gray-700 hover:bg-transparent focus:bg-transparent data-[state=open]:bg-transparent"
                : isHeaderTile
                  ? "bg-primary hover:bg-primary/90! focus:bg-primary! data-[state=open]:bg-primary! flex! h-full min-h-[112px] w-full! flex-col items-center justify-center gap-1.5 rounded-none px-0 text-white data-[state=open]:text-white!"
                  : "h-10 gap-2 rounded-t-md px-4 text-sm text-white hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white data-[state=open]:rounded-b-none data-[state=open]:border-gray-200 data-[state=open]:border-b-transparent data-[state=open]:bg-white data-[state=open]:text-gray-900 data-[state=open]:hover:bg-white data-[state=open]:hover:text-gray-900"
            )}
          >
            <CategoryDropdownTrigger variant={variant} />
          </NavigationMenuTrigger>

          <NavigationMenuContent className="left-0 animate-none!">
            <div
              className={cn(
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150 motion-safe:ease-out",
                "overflow-hidden rounded-tr-lg rounded-b-lg border border-gray-200 bg-white shadow-[2px_4px_5px_rgba(0,0,0,0.3)]",
                isHeaderTile
                  ? "w-[1040px] max-w-[calc(100vw-28px)]"
                  : isQuickLink
                    ? "w-max max-w-[calc(100vw-28px)]"
                    : "w-max max-w-[calc(100vw-80px)]"
              )}
            >
              {categories.length > 0 ? (
                <MegaMenu categories={categories} />
              ) : (
                <div className="py-10 text-center text-sm text-gray-500">
                  카테고리를 불러오지 못했어요.
                </div>
              )}
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  )
}
