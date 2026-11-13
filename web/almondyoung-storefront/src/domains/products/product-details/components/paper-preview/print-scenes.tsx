"use client"

import { useTranslations } from "next-intl"
import { PhotoMockupScene, useTemplateArt } from "./photo-layer"
import { PRINT_SCENES } from "./photo-mockup"
import type { PaperShape } from "./paper"

// 상세 본문의 큰 장면 사진. 그 상품 시안을 실제 매장 장면에 붙여 보여 준다
export function PrintScenes({
  shape,
  templateId,
  name,
}: {
  shape: PaperShape
  templateId: string
  name: string
}) {
  const t = useTranslations("productDetail.paperPreview")
  const art = useTemplateArt(templateId)
  const scenes = PRINT_SCENES[shape] ?? []

  return (
    <div className="flex flex-col gap-3">
      {scenes.map((mockup) => (
        <div
          key={mockup.background}
          role="img"
          aria-label={t("sceneAlt", { name })}
          className="bg-muted relative aspect-square w-full overflow-hidden rounded-2xl"
        >
          {art && <PhotoMockupScene mockup={mockup} art={art} />}
        </div>
      ))}
    </div>
  )
}
