import { getTranslations } from "next-intl/server"
import type { PaperShape } from "./paper"
import { hasPrintScenes } from "./photo-mockup"
import { PrintScenes } from "./print-scenes"

// 사양표 칸. 값은 messages 의 printDetail.spec.<shape>.<row> 에 있고, 없는 칸은 그리지 않는다
const SPEC_ROWS = ["material", "print", "finish", "addOn"] as const

const SPEC_KEYS: Record<PaperShape, (typeof SPEC_ROWS)[number][]> = {
  card: ["material", "print", "addOn"],
  card_portrait: ["material", "print", "addOn"],
  nail: ["material", "print"],
  mini: ["material", "print", "finish", "addOn"],
  pet: ["material", "print", "finish", "addOn"],
  window: ["material", "print", "finish", "addOn"],
  menu: ["material", "print", "addOn"],
}

const STEPS = ["edit", "print", "ship"] as const
const NOTES = ["color", "custom", "defect"] as const

// 아몬드템플릿 인쇄 상품의 상세 본문. 게시할 때 상세 이미지가 따로 없어 더보기 아래가 비지 않게 한다
export async function PrintDetail({
  shape,
  size,
  thumbnail,
  name,
  templateId,
}: {
  shape: PaperShape
  size: string
  thumbnail?: string
  name: string
  templateId: string
}) {
  const t = await getTranslations("productDetail.printDetail")
  const [widthMm, heightMm] = size.split("x").map(Number)

  return (
    <section className="mx-auto flex max-w-[640px] flex-col gap-10 py-6">
      {hasPrintScenes(shape) ? (
        <PrintScenes shape={shape} templateId={templateId} name={name} />
      ) : (
        thumbnail && (
          <figure className="bg-muted flex flex-col items-center gap-3 rounded-2xl px-6 py-10">
            {/* eslint-disable-next-line @next/next/no-img-element -- 템플릿 썸네일은 ugc 가 주는 SVG 라 next/image 최적화 대상이 아니다 */}
            <img
              src={thumbnail}
              alt={t("heroAlt", { name })}
              loading="lazy"
              className="max-h-[560px] w-auto max-w-full rounded shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
            />
            <figcaption className="text-muted-foreground text-sm">
              {t("heroCaption")}
            </figcaption>
          </figure>
        )
      )}

      <div className="flex flex-col gap-4">
        <h3 className="text-foreground text-center text-xl font-bold">
          {t("stepsTitle")}
        </h3>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className="border-border flex flex-col gap-1 rounded-xl border p-4"
            >
              <span className="bg-secondary text-foreground grid size-7 place-items-center rounded-full text-sm font-bold">
                {i + 1}
              </span>
              <strong className="text-foreground mt-1 text-base font-bold">
                {t(`steps.${step}.title`)}
              </strong>
              <span className="text-muted-foreground text-sm leading-normal">
                {t(`steps.${step}.body`)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="text-foreground text-center text-xl font-bold">
          {t("specTitle")}
        </h3>
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">{t("specTitle")}</caption>
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[70%]" />
          </colgroup>
          <tbody>
            <tr>
              <th
                scope="row"
                className="border-border bg-muted border px-3 py-2.5 text-left font-semibold"
              >
                {t("rows.size")}
              </th>
              <td className="border-border border px-3 py-2.5">
                {t("sizeValue", { width: widthMm / 10, height: heightMm / 10 })}
              </td>
            </tr>
            {SPEC_KEYS[shape].map((row) => (
              <tr key={row}>
                <th
                  scope="row"
                  className="border-border bg-muted border px-3 py-2.5 text-left font-semibold"
                >
                  {t(`rows.${row}`)}
                </th>
                <td className="border-border border px-3 py-2.5 break-keep">
                  {t(`spec.${shape}.${row}`)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-muted flex flex-col gap-3 rounded-xl p-5">
        <h3 className="text-foreground text-base font-bold">
          {t("notesTitle")}
        </h3>
        <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm leading-normal">
          {NOTES.map((note) => (
            <li key={note}>{t(`notes.${note}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
