"use client"

import { useTranslations } from "next-intl"
import { DesignThumbnail } from "@/domains/almond-template/components/design-thumbnail"

// 아몬드템플릿에서 「이 시안으로 주문하기」로 넘어왔을 때, 옵션을 고르기 전부터 시안이 붙어 있음을 보여 준다
export function AlmondDesignNotice({
  designId,
  attached,
  hint,
}: {
  designId: string
  attached: boolean
  hint?: string
}) {
  const t = useTranslations("productDetail.options")
  return (
    <div className="border-border bg-muted flex items-center gap-3 rounded-lg border p-3">
      <DesignThumbnail
        id={designId}
        className="h-14 w-20 rounded border bg-white"
      />
      <div className="min-w-0 text-sm">
        <p className="text-foreground font-semibold">
          {t("almondDesignTitle")}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {hint ??
            (attached
              ? t("almondDesignAttached")
              : t("almondDesignChooseOption"))}
        </p>
      </div>
    </div>
  )
}
