"use client"

import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useTranslations } from "next-intl"

export type CancelReasonCode =
  | "CHANGE_OF_MIND"
  | "WRONG_ORDER"
  | "FOUND_CHEAPER"
  | "DELAY"
  | "OTHER"

const REASON_CODES: CancelReasonCode[] = [
  "CHANGE_OF_MIND",
  "WRONG_ORDER",
  "FOUND_CHEAPER",
  "DELAY",
  "OTHER",
]

interface CancelReasonFormProps {
  reasonCode: CancelReasonCode
  reasonDetail: string
  onReasonCodeChange: (code: CancelReasonCode) => void
  onReasonDetailChange: (detail: string) => void
}

export function CancelReasonForm({
  reasonCode,
  reasonDetail,
  onReasonCodeChange,
  onReasonDetailChange,
}: CancelReasonFormProps) {
  const t = useTranslations("mypage.order.cancelDialog")

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">{t("reasonLabel")}</p>
      <RadioGroup
        value={reasonCode}
        onValueChange={(val) => onReasonCodeChange(val as CancelReasonCode)}
        className="space-y-1.5"
      >
        {REASON_CODES.map((code) => (
          <div key={code} className="flex items-center gap-2">
            <RadioGroupItem value={code} id={`cancel-reason-${code}`} />
            <Label
              htmlFor={`cancel-reason-${code}`}
              className="cursor-pointer text-sm text-gray-700"
            >
              {t(`reasons.${code}`)}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {reasonCode === "OTHER" && (
        <Textarea
          value={reasonDetail}
          onChange={(e) => onReasonDetailChange(e.target.value)}
          placeholder={t("otherPlaceholder")}
          maxLength={500}
          className="mt-1.5 text-sm"
          rows={3}
        />
      )}
    </div>
  )
}
