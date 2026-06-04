"use client"

import { BusinessInfo } from "@/lib/types/ui/user"
import { Badge } from "@components/common/ui/badge"
import { Button } from "@components/common/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@components/common/ui/dialog"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"
import { Pencil } from "lucide-react"
import { useTranslations } from "next-intl"
import Image from "next/image"

interface BusinessDisplayProps {
  data: BusinessInfo
  onEdit: () => void
}

export default function BusinessDisplay({
  data,
  onEdit,
}: BusinessDisplayProps) {
  const t = useTranslations("business.display")

  // 검증 상태별 뱃지 매핑 함수
  const getStatusBadge = (status?: BusinessInfo["status"]) => {
    switch (status) {
      case "approved":
        return (
          <Badge
            variant="secondary"
            className="border-green-300 bg-green-100 text-green-700"
          >
            {t("statusApproved")}
          </Badge>
        )
      case "under_review":
        return (
          <Badge
            variant="outline"
            className="border-yellow-300 bg-yellow-100 text-yellow-800"
          >
            {t("statusUnderReview")}
          </Badge>
        )
      case "rejected":
        return (
          <Badge
            variant="destructive"
            className="border-red-300 bg-red-100 text-red-700"
          >
            {t("statusRejected")}
          </Badge>
        )
      default:
        return <Badge variant="secondary">{t("statusNone")}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-border bg-card rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {/* 검증 상태 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left align-top font-medium">
                {t("statusLabel")}
              </th>
              <td className="px-4 py-4">
                {getStatusBadge(data.status)}
                {data.reviewComment && data.status === "rejected" && (
                  <div className="text-muted-foreground mt-1 text-xs">
                    {data.reviewComment}
                  </div>
                )}
              </td>
            </tr>
            {/* 사업자등록번호 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left font-medium">
                {t("businessNumberLabel")}
              </th>
              <td className="text-foreground px-4 py-4">
                {formatBusinessNumber(data.businessNumber ?? "")}
              </td>
            </tr>
            {/* 대표자명 */}
            <tr className="border-b last:border-b-0">
              <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left font-medium">
                {t("representativeNameLabel")}
              </th>
              <td className="text-foreground px-4 py-4">
                {data.representativeName}
              </td>
            </tr>
            {/* 파일 정보 */}
            {data.fileUrl && (
              <tr className="border-b last:border-b-0">
                <th className="text-muted-foreground min-w-[140px] px-4 py-4 text-left align-top font-medium">
                  {t("fileLabel")}
                </th>
                <td className="text-foreground px-4 py-4">
                  <Dialog>
                    <DialogTrigger asChild>
                      <div className="flex cursor-pointer items-center gap-2">
                        <Image
                          src={data.fileUrl}
                          alt={t("fileAlt")}
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
                        {t("fileDialogTitle")}
                      </DialogTitle>
                      <DialogDescription className="sr-only">
                        {t("fileDialogDescription")}
                      </DialogDescription>

                      <div className="flex flex-col items-center p-2">
                        <Image
                          src={data.fileUrl}
                          alt={t("fileAlt")}
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
          {t("editButton")}
        </Button>
      </div>
    </div>
  )
}
