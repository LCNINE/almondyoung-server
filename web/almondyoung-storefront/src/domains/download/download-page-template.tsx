"use client"

import { Button } from "@components/common/ui/button"
import type { UserDetail } from "types/global"
import { ChevronLeft, ChevronRight, Filter } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { DownloadCard } from "./components/download-card"
import { DownloadFilters } from "./components/download-filters"
import type { DigitalAssetLicense } from "@lib/types/ui/digital-aseet.ui"

interface DownloadPageTemplateProps {
  user: UserDetail
  digitalAssets: DigitalAssetLicense[]
  currentPage: number
  itemsPerPage: number
  is_exercised: string | null
}

export interface DigitalAssetsResponse {
  success: boolean
  data: {
    licenses: DigitalAssetLicense[]
    count: number
    skip: number
    take: number
  }
}

export default function DownloadPageTemplate({
  user,
  digitalAssets,
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

  const filteredDigitalAssets = digitalAssets?.filter(
    (asset: DigitalAssetLicense) => {
      if (filter === "new") return !asset.is_exercised
      if (filter === "used") return asset.is_exercised
      return true
    }
  )

  const totalPages = Math.ceil(digitalAssets.length / itemsPerPage)

  const handlePageChange = (page: number) => {
    router.push(
      `${pathname}?page=${page}&is_exercised=${filter === "new" ? "false" : filter === "used" ? "true" : ""}`
    )
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <div className="bg-background min-h-screen">
        <div className="container mx-auto max-w-7xl px-4 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-bold">다운로드</h1>
            <p className="text-muted-foreground">
              구매하신 디지털 상품을 다운로드하세요
            </p>
          </div>

          {/* Filters */}
          <div className="mb-6 flex items-center justify-between">
            <div className="text-muted-foreground text-sm">
              총{" "}
              <span className="text-foreground font-semibold">
                {digitalAssets.length}
              </span>
              개의 상품
            </div>
            <DownloadFilters
              currentFilter={filter}
              onFilterChange={(filter) => {
                setFilter(filter)

                router.push(
                  `${pathname}?page=${currentPage}&is_exercised=${filter === "new" ? "false" : filter === "used" ? "true" : ""}`
                )
              }}
            />
          </div>

          {/* Products Grid */}
          {filteredDigitalAssets?.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDigitalAssets.map((filteredDigitalAsset) => (
                  <DownloadCard
                    key={filteredDigitalAsset.id}
                    digitalAsset={filteredDigitalAsset}
                    isExercised={filteredDigitalAsset.is_exercised}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    이전
                  </Button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => {
                        // 현재 페이지 주변만 표시
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
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="py-16 text-center">
              <div className="bg-muted mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full">
                <Filter className="text-muted-foreground h-8 w-8" />
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
