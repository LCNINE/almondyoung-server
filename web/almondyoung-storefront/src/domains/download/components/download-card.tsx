"use client"

import { Badge } from "@components/common/ui/badge"
import { Button } from "@components/common/ui/button"
import { cn } from "@lib/utils"
import { format } from "date-fns"
import {
  downloadDigitalAssetAction,
  updateDigitalAssetExerciseAction,
} from "domains/mypage/actions/digital-asset-actions"
import { DigitalAssetLicense } from "domains/mypage/types/mypage-types"
import { Cat, Check, Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

interface DownloadCardProps {
  digitalAsset: DigitalAssetLicense
  isExercised: boolean
}

export function DownloadCard({ digitalAsset, isExercised }: DownloadCardProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handleDownload = async (assetId: string) => {
    setDownloadingId(assetId)

    try {
      const result = await downloadDigitalAssetAction(assetId)

      setDownloadingId(null)

      if (result.success && result.data) {
        // Base64 데이터를 Blob으로 변환
        const binaryString = atob(result.data.base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: result.data.mimeType })

        // Blob URL 생성 및 다운로드 트리거
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = result.data.filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)

        toast.success("다운로드 시작", {
          description: result.message,
        })
      } else {
        toast.error("다운로드 실패", {
          description: result.message,
        })
      }
    } catch (error) {
      setDownloadingId(null)
      toast.error("오류 발생", {
        description: "다운로드 중 오류가 발생했습니다.",
      })
    }
  }

  const handleExercise = async (assetId: string, assetName: string) => {
    const confirmed = window.confirm(
      `정말로 ${assetName}을(를) 사용 처리하시겠습니까? 한번 사용 처리된 상품은 반품이 불가능합니다.`
    )

    if (confirmed) {
      try {
        const result = await updateDigitalAssetExerciseAction(assetId)

        if (result.success) {
          toast.success("사용 처리 완료", {
            description: result.message,
          })
        } else {
          toast.error("사용 처리 실패", {
            description: result.message,
          })
        }
      } catch (error) {
        toast.error("오류 발생", {
          description: "라이센스 사용 처리 중 오류가 발생했습니다.",
        })
      }
    }
  }

  return (
    <div
      className={cn(
        "group bg-card relative overflow-hidden rounded-lg border transition-all duration-300",
        "hover:border-primary/50 hover:shadow-lg",
        downloadingId === digitalAsset.id && "opacity-80"
      )}
    >
      {/* Thumbnail */}
      <div className="bg-muted relative aspect-video overflow-hidden">
        <img
          src={digitalAsset?.digital_asset?.thumbnail_url}
          alt={digitalAsset?.digital_asset?.name}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
            {digitalAsset?.digital_asset?.name}
          </h3>

          {/* todo : 구매일자 표시 추가 필요 */}
          {/* <div className="text-muted-foreground flex items-center justify-between text-sm">
            <span>
              {format(digitalAsset?.digital_asset?.created_at, "yyyy-MM-dd")}
            </span>
          </div> */}
        </div>

        {/* Download Button */}
        <CardButton
          isExercised={isExercised}
          onDownload={handleDownload}
          onExercise={handleExercise}
          digitalAsset={digitalAsset}
        />
      </div>
    </div>
  )
}

function CardButton({
  isExercised,
  onDownload,
  onExercise,
  digitalAsset,
}: {
  isExercised: boolean
  onDownload: (id: string) => void
  onExercise: (id: string, name: string) => void
  digitalAsset: DigitalAssetLicense
}) {
  const isDownloading = false

  switch (isExercised) {
    case true:
      return (
        <Button
          onClick={() => onDownload(digitalAsset.id)}
          disabled={isDownloading}
          className="group/btn w-full cursor-pointer"
          variant="default"
        >
          <Download className="mr-2 h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" />
          {isDownloading ? "다운로드 중..." : "다운로드"}
        </Button>
      )
    case false:
      return (
        <Button
          onClick={() =>
            onExercise(digitalAsset.id, digitalAsset.digital_asset.name)
          }
          disabled={isDownloading}
          className="group/btn w-full cursor-pointer"
          variant="destructive"
        >
          <Cat className="mr-2 h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" />
          라이센스 사용하기
        </Button>
      )
    default:
      return (
        <Button
          onClick={() => onDownload(digitalAsset.id)}
          disabled={isDownloading}
          className="group/btn w-full cursor-pointer"
          variant="default"
        >
          <Download className="mr-2 h-4 w-4 transition-transform group-hover/btn:translate-y-0.5" />
          {isDownloading ? "다운로드 중..." : "다운로드"}
        </Button>
      )
  }
}
