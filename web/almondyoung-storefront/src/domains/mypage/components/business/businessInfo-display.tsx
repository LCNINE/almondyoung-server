"use client"

import { Badge } from "@components/common/ui/badge"
import { Button } from "@components/common/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@components/common/ui/dialog"
import type { BusinessInfo } from "@lib/api/users/business/types"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"
import { Pencil } from "lucide-react"
import Image from "next/image"

interface BusinessInfoDisplayProps {
  data: BusinessInfo
  onEdit: () => void
}

// 검증 상태별 뱃지 매핑 함수
const getStatusBadge = (status?: BusinessInfo["status"]) => {
  switch (status) {
    case "approved":
      return (
        <Badge
          variant="secondary"
          className="border-green-300 bg-green-100 text-green-700"
        >
          승인됨
        </Badge>
      )
    case "under_review":
      return (
        <Badge
          variant="outline"
          className="border-yellow-300 bg-yellow-100 text-yellow-800"
        >
          심사중
        </Badge>
      )
    case "rejected":
      return (
        <Badge
          variant="destructive"
          className="border-red-300 bg-red-100 text-red-700"
        >
          반려됨
        </Badge>
      )
    default:
      return <Badge variant="secondary">없음</Badge>
  }
}

export default function BusinessInfoDisplay({
  data,
  onEdit,
}: BusinessInfoDisplayProps) {
  return (
    <div className="space-y-6">
      <div className="border-border bg-card rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {/* 검증 상태 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left align-top font-medium">
                검증 상태:
              </th>
              <td className="px-4 py-4">
                {getStatusBadge(data.status)}
                {data.reviewComment && (
                  <div className="text-muted-foreground mt-1 text-xs">
                    {data.reviewComment}
                  </div>
                )}
              </td>
            </tr>
            {/* 사업자등록번호 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left font-medium">
                사업자등록번호:
              </th>
              <td className="text-foreground px-4 py-4">
                {formatBusinessNumber(data.businessNumber ?? "")}
              </td>
            </tr>
            {/* 대표자명 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left font-medium">
                대표자명:
              </th>
              <td className="text-foreground px-4 py-4">
                {data.representativeName}
              </td>
            </tr>
            {/* 파일 정보 */}
            {data.fileUrl && (
              <tr className="border-b last:border-b-0">
                <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left align-top font-medium">
                  사업자등록증:
                </th>
                <td className="text-foreground px-4 py-4">
                  <Dialog>
                    <DialogTrigger asChild>
                      <div className="flex cursor-pointer items-center gap-2">
                        <Image
                          src={data.fileUrl}
                          alt="사업자등록증"
                          width={100}
                          height={100}
                          className="rounded border"
                        />
                        <span>{getDisplayFilename(data.fileUrl)}</span>
                      </div>
                    </DialogTrigger>
                    <DialogContent
                      className="w-auto max-w-[90vw]"
                      aria-describedby="business-file-dialog-desc"
                    >
                      <DialogTitle className="sr-only">
                        사업자등록증 전체 보기
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        사업자등록증 이미지를 크게 볼 수 있습니다
                      </DialogDescription>

                      <div className="flex flex-col items-center p-2">
                        <Image
                          src={data.fileUrl}
                          alt="사업자등록증"
                          width={600}
                          height={600}
                          className="h-auto max-w-full rounded border"
                          style={{ objectFit: "contain" }}
                        />
                        <span
                          id="business-file-dialog-desc"
                          className="text-muted-foreground mt-2 text-xs"
                        >
                          {getDisplayFilename(data.fileUrl)}
                        </span>
                      </div>
                    </DialogContent>
                  </Dialog>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 수정 버튼 */}
      <div className="flex justify-end">
        <Button onClick={onEdit} className="gap-2">
          <Pencil className="h-4 w-4" />
          정보 수정
        </Button>
      </div>
    </div>
  )
}
