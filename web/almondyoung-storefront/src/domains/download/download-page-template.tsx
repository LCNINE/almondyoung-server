"use client"

import { Button } from "@components/common/ui/button"

import { ChevronLeft, ChevronRight, Filter } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { DownloadCard } from "./components/download-card"
import { DownloadFilters } from "./components/download-filters"
import type { DigitalAssetOwnership } from "@lib/types/ui/library.ui"
import { UserDetail } from "@/lib/types/ui/user"

interface DownloadPageTemplateProps {
  user: UserDetail
  ownerships: DigitalAssetOwnership[]
  total: number
  currentPage: number
  itemsPerPage: number
  is_exercised: string | null
}

export default function DownloadPageTemplate({
  user,
  ownerships,
  total,
  currentPage,
  itemsPerPage,
  is_exercised,
}: DownloadPageTemplateProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [filter, setFilter] = useState<"all" | "new" | "used">("all")

  useEffect(() => {
    setFilter(
      is_exercised === "false"
        ? "new"
        : is_exercised === "true"
          ? "used"
          : "all"
    )
  }, [is_exercised])

  // 서버 측에서 이미 filter 가 적용된 결과를 받으므로 클라이언트 추가 필터는 불필요.
  const totalPages = Math.max(1, Math.ceil(total / itemsPerPage))

  const handlePageChange = (page: number) => {
    router.push(
      `${pathname}?page=${page}&is_exercised=${filter === "new" ? "false" : filter === "used" ? "true" : ""}`
    )
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <div className="min-h-screen bg-background">
        <div className="container px-4 py-8 mx-auto max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold">다운로드</h1>
            <p className="text-muted-foreground">
              구매하신 디지털 상품을 다운로드하세요
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-sm text-muted-foreground">
              총 <span className="font-semibold text-foreground">{total}</span>
              개의 상품
            </div>
            <DownloadFilters
              currentFilter={filter}
              onFilterChange={(next) => {
                setFilter(next)

                router.push(
                  `${pathname}?page=1&is_exercised=${next === "new" ? "false" : next === "used" ? "true" : ""}`
                )
              }}
            />
          </div>

          {/* Products Grid */}
          {ownerships.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {ownerships.map((ownership) => (
                  <DownloadCard
                    key={ownership.id}
                    ownership={ownership}
                    isExercised={!!ownership.exercisedAt}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    이전
                  </Button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => {
                        if (
                          page === 1 ||
                          page === totalPages ||
                          (page >= currentPage - 1 && page <= currentPage + 1)
                        ) {
                          return (
                            <Button
                              key={page}
                              variant={
                                page === currentPage ? "default" : "outline"
                              }
                              size="sm"
                              onClick={() => handlePageChange(page)}
                              className="min-w-[40px]"
                            >
                              {page}
                            </Button>
                          )
                        } else if (
                          page === currentPage - 2 ||
                          page === currentPage + 2
                        ) {
                          return (
                            <span key={page} className="px-2">
                              ...
                            </span>
                          )
                        }
                        return null
                      }
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    다음
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="py-16 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-muted">
                <Filter className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">상품이 없습니다</h3>
              <p className="text-muted-foreground">
                선택한 필터에 해당하는 상품이 없습니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
