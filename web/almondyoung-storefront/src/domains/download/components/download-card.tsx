"use client"

import { Badge } from "@components/common/ui/badge"
import { Button } from "@components/common/ui/button"
import { cn } from "@lib/utils"
import {
  downloadOwnership,
  exerciseOwnership,
} from "@lib/api/library/library-api"
import type { DigitalAssetOwnership } from "@lib/types/ui/library.ui"
import { Cat, Check, Download } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import Image from "next/image"

interface DownloadCardProps {
  ownership: DigitalAssetOwnership
  isExercised: boolean
}

export function DownloadCard({ ownership, isExercised }: DownloadCardProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleDownload = (ownershipId: string) => {
    setIsDownloading(true)
    startTransition(async () => {
      try {
        const result = await downloadOwnership(ownershipId)

        if (!result.success) {
          toast.error("다운로드 실패", { description: result.message })
          return
        }

        const binaryString = atob(result.base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: result.mimeType })

        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = result.filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)

        toast.success("다운로드 시작", { description: result.filename })
      } catch (err: unknown) {
        const e = err as Error & { digest?: string }
        if (e.digest === "UNAUTHORIZED" || e.message === "UNAUTHORIZED") {
          throw err
        }
        toast.error("오류 발생", {
          description: "다운로드 중 오류가 발생했습니다.",
        })
      } finally {
        setIsDownloading(false)
      }
    })
  }

  const handleExercise = (ownershipId: string, assetName: string) => {
    const confirmed = window.confirm(
      `정말로 ${assetName}을(를) 사용 처리하시겠습니까? 한번 사용 처리된 상품은 반품이 불가능합니다.`
    )
    if (!confirmed) return

    startTransition(async () => {
      try {
        const result = await exerciseOwnership(ownershipId)
        if (result.success) {
          toast.success("사용 처리 완료", {
            description: "라이센스가 사용 처리되었습니다.",
          })
        } else {
          toast.error("사용 처리 실패", { description: result.message })
        }
      } catch (err: unknown) {
        const e = err as Error & { digest?: string }
        if (e.digest === "UNAUTHORIZED" || e.message === "UNAUTHORIZED") {
          throw err
        }
        toast.error("오류 발생", {
          description: "라이센스 사용 처리 중 오류가 발생했습니다.",
        })
      }
    })
  }

  const busy = isDownloading || isPending

  return (
    <div
      className={cn(
        "group bg-card relative overflow-hidden rounded-lg border transition-all duration-300",
        "hover:border-primary/50 hover:shadow-lg",
        busy && "opacity-80"
      )}
    >
      {/* Thumbnail */}
      <div className="bg-muted relative aspect-video overflow-hidden">
        <Image
          src={ownership.asset.thumbnailUrl || ""}
          alt={ownership.asset.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          width={100}
          height={100}
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Status Badge */}
        <div className="absolute top-3 right-3">
          {isExercised ? (
            <Badge variant="default">
              <Check className="mr-1 h-3 w-3" />
              사용됨
            </Badge>
          ) : (
            <Badge variant="default">새로운</Badge>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-card-foreground mb-1 truncate font-semibold">
            {ownership.asset.name}
          </h3>
        </div>

        {/* Action Button */}
        {isExercised ? (
          <Button
            onClick={() => handleDownload(ownership.id)}
            disabled={busy}
            className="group/btn w-full cursor-pointer"
            variant="default"
          >
            <Download className="mr-2 h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" />
            {isDownloading ? "다운로드 중..." : "다운로드"}
          </Button>
        ) : (
          <Button
            onClick={() => handleExercise(ownership.id, ownership.asset.name)}
            disabled={busy}
            className="group/btn w-full cursor-pointer"
            variant="destructive"
          >
            <Cat className="mr-2 h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" />
            라이센스 사용하기
          </Button>
        )}
      </div>
    </div>
  )
}
