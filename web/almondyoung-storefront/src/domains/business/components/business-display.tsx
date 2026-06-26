"use client"

import { BusinessInfo } from "@/lib/types/ui/user"
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
import type { ReactNode } from "react"

interface BusinessDisplayProps {
  data: BusinessInfo
  onEdit: () => void
}

export default function BusinessDisplay({
  data,
  onEdit,
}: BusinessDisplayProps) {
  const t = useTranslations("business.display")

  const getStatusBadge = (status?: BusinessInfo["status"]) => {
    const tone: Record<string, { pill: string; dot: string }> = {
      approved: { pill: "bg-emerald-500/10 text-emerald-700", dot: "bg-emerald-500" },
      under_review: { pill: "bg-amber-500/10 text-amber-700", dot: "bg-amber-500" },
      rejected: { pill: "bg-red-500/10 text-red-600", dot: "bg-red-500" },
      none: { pill: "bg-gray-500/10 text-gray-600", dot: "bg-gray-400" },
    }
    const label = {
      approved: t("statusApproved"),
      under_review: t("statusUnderReview"),
      rejected: t("statusRejected"),
      none: t("statusNone"),
    }
    const key = status ?? "none"
    const { pill, dot } = tone[key] ?? tone.none
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label[key as keyof typeof label] ?? label.none}
      </span>
    )
  }

  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <dt className="shrink-0 text-sm font-medium text-gray-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-gray-900">
        {children}
      </dd>
    </div>
  )

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <Row label={t("statusLabel")}>
          {getStatusBadge(data.status)}
          {data.reviewComment && data.status === "rejected" && (
            <div className="mt-1 text-xs font-normal text-gray-400">
              {data.reviewComment}
            </div>
          )}
        </Row>

        <Row label={t("businessNumberLabel")}>
          {formatBusinessNumber(data.businessNumber ?? "")}
        </Row>

        <Row label={t("representativeNameLabel")}>
          {data.representativeName}
        </Row>

        {data.fileUrl && (
          <Row label={t("fileLabel")}>
            <Dialog>
              <DialogTrigger asChild>
                <div className="flex cursor-pointer items-center gap-2">
                  <Image
                    src={data.fileUrl}
                    alt={t("fileAlt")}
                    width={100}
                    height={100}
                    className="rounded-lg border border-gray-100"
                  />
                  <span className="font-normal text-gray-500">
                    {getDisplayFilename(data.fileUrl)}
                  </span>
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
                    className="h-auto max-w-full rounded-lg border border-gray-100"
                    style={{ objectFit: "contain" }}
                  />
                  <span
                    id="business-file-dialog-desc"
                    className="mt-2 text-xs text-gray-400"
                  >
                    {getDisplayFilename(data.fileUrl)}
                  </span>
                </div>
              </DialogContent>
            </Dialog>
          </Row>
        )}
      </dl>

      <div className="flex justify-end">
        <Button onClick={onEdit} className="gap-2">
          <Pencil className="h-4 w-4" />
          {t("editButton")}
        </Button>
      </div>
    </div>
  )
}
