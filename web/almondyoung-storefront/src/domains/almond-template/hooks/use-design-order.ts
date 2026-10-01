import { useParams, useRouter } from "next/navigation"
import { useTransition } from "react"
import { uploadFile } from "@/lib/api/file/upload"
import { createAlmondDesign } from "@/lib/api/ugc/almond-designs"
import { printSvg } from "../components/print-svg"
import { PRINT_SPECS } from "../lib/catalog"
import { uploadDesignImages } from "../lib/design-images"
import type { Design } from "../lib/document"

type Params = {
  design: Design
  productId: string
  variantId: string
  templateId: string
  runAuthed: (task: () => Promise<void>, failure: string) => Promise<void>
  forgetBackup: () => Promise<unknown>
}

export function useDesignOrder({
  design,
  productId,
  variantId,
  templateId,
  runAuthed,
  forgetBackup,
}: Params) {
  const router = useRouter()
  const { countryCode } = useParams<{ countryCode: string }>()
  const [ordering, startTransition] = useTransition()
  const orderDesign = () =>
    startTransition(() =>
      runAuthed(async () => {
        const stored = await uploadDesignImages(design, uploadFile)
        const bleedMm = PRINT_SPECS[stored.kind].bleedMm
        const [frontSvg, backSvg] = await Promise.all([
          printSvg(stored, "front", bleedMm),
          stored.back.length
            ? printSvg(stored, "back", bleedMm)
            : Promise.resolve(undefined),
        ])
        const { id } = await createAlmondDesign({
          design: stored,
          frontSvg,
          backSvg,
          templateId: templateId || undefined,
        })
        await forgetBackup()
        router.push(
          `/${countryCode}/products/${productId}?v_id=${variantId}&almond_design=${id}`
        )
      }, "주문용 시안을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.")
    )

  return { ordering, orderDesign }
}
