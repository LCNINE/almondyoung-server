import Image from "next/image"
import { useTranslations } from "next-intl"
import { PAPER_MODELS, type PaperShape, type PaperVariant } from "./paper"

const PAPERS: PaperVariant[] = ["uncoated", "matte_coated"]

// 상세정보 본문 맨 위에 두 용지를 크게 견줘 보여 준다
export function PaperCompare({ shape }: { shape: PaperShape }) {
  const t = useTranslations("productDetail.paperPreview")

  return (
    <section className="mx-auto flex max-w-[860px] flex-col gap-4 py-8">
      <div className="flex flex-col gap-1 text-center">
        <h3 className="text-foreground text-xl font-bold">
          {t("compareTitle")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("compareLead")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PAPERS.map((paper) => (
          <figure key={paper} className="flex flex-col gap-3">
            <Image
              src={`${PAPER_MODELS[shape].macroPrefix}${paper}.jpg`}
              alt={t(`${paper}.caption`)}
              width={900}
              height={600}
              sizes="(min-width: 768px) 430px, 100vw"
              className="aspect-[3/2] w-full rounded-xl object-cover"
            />
            <figcaption className="flex flex-col gap-1">
              <span className="text-foreground text-base font-bold">
                {t(`${paper}.caption`)}
              </span>
              <span className="text-muted-foreground text-sm">
                {t(`${paper}.description`)}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-muted-foreground text-center text-xs">
        {t("disclaimer")}
      </p>
    </section>
  )
}
