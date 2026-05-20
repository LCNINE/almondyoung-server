"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useScrollSpy } from "@/hooks/use-scroll-spy"
import { listCategories } from "@/lib/api/medusa/categories"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { AlertCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { CategorySection } from "./category-section"
import { SidebarTabs } from "./sidebar-tabs"

interface CategorySheetProps {
  trigger: React.ReactNode
}

export function CategorySheet({ trigger }: CategorySheetProps) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [categories, setCategories] = useState<StoreProductCategoryTree[]>([])
  const [isError, setIsError] = useState(false)
  const t = useTranslations("categorySheet")

  const scrollRef = useRef<HTMLElement>(null)
  const sectionIds = useMemo(() => categories.map((c) => c.id), [categories])
  const activeId = useScrollSpy(sectionIds, scrollRef)

  useEffect(() => {
    if (!open || categories.length > 0) return
    startTransition(async () => {
      try {
        const list = await listCategories({ parent_category_id: "null" })
        setCategories(list)
        setIsError(false)
      } catch (err) {
        console.error(err)
        setIsError(true)
      }
    })
  }, [open, categories.length])

  const handleTabSelect = (id: string) => {
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector<HTMLElement>(`[data-section-id="${id}"]`)
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const closeSheet = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="cursor-pointer" asChild>
        {trigger}
      </SheetTrigger>

      <SheetContent
        side="left"
        className="z-999 flex w-[85%] max-w-[400px] flex-col border-none bg-white p-0 outline-none"
      >
        <SheetHeader className="border-b border-gray-100 px-5 py-4 text-left">
          <SheetTitle className="text-[17px] font-bold">
            {t("title")}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("title")}</SheetDescription>
        </SheetHeader>

        {isError ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <AlertCircle
              className="mb-4 h-10 w-10 text-red-200"
              strokeWidth={1.5}
            />
            <p className="text-[12px] leading-relaxed text-gray-400">
              {t("errorLine1")}
              <br />
              {t("errorLine2")}
            </p>
          </div>
        ) : isPending && categories.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-6 w-24 animate-pulse rounded bg-gray-100" />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <SidebarTabs
              categories={categories}
              activeId={activeId}
              onSelect={handleTabSelect}
            />
            <main ref={scrollRef} className="flex-1 overflow-y-auto bg-white">
              {categories.map((cat) => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  onNavigate={closeSheet}
                />
              ))}
            </main>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
