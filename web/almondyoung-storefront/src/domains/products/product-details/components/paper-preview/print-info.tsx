import { getTranslations } from "next-intl/server"
import { PAPER_ASSETS, type PaperShape } from "./paper"

type InfoShape = Extract<PaperShape, "mini" | "pet" | "window" | "menu">

// 도면의 구멍은 위치만 보여 주는 표시다(와우프레스가 치수를 공개하지 않아 숫자는 적지 않는다).
// throughFront 는 투명 필름이라 뒤에서 그림이 좌우로 비치는 것을 함께 보여 준다
const PRINT_INFO: Record<
  InfoShape,
  { holes: boolean; throughFront: boolean; closeUp: string }
> = {
  mini: {
    holes: true,
    throughFront: true,
    closeUp: `${PAPER_ASSETS}/mini-hook-v1.jpg`,
  },
  pet: {
    holes: true,
    throughFront: false,
    closeUp: `${PAPER_ASSETS}/pet-eyelet-v1.jpg`,
  },
  window: {
    holes: false,
    throughFront: false,
    closeUp: `${PAPER_ASSETS}/window-cup-v1.jpg`,
  },
  menu: {
    holes: false,
    throughFront: false,
    closeUp: `${PAPER_ASSETS}/menu-cup-v1.jpg`,
  },
}

export function hasPrintInfo(shape: PaperShape): shape is InfoShape {
  return shape in PRINT_INFO
}

// 용지 비교 사진 자리에, 받는 인쇄물의 크기·소재·거는 법을 세 칸으로 보여 준다
export async function PrintInfo({
  shape,
  size,
  thumbnail,
}: {
  shape: InfoShape
  size: string
  thumbnail?: string
}) {
  const t = await getTranslations(`productDetail.printInfo.${shape}`)
  const tAll = await getTranslations("productDetail.printInfo")
  const config = PRINT_INFO[shape]
  const [widthMm, heightMm] = size.split("x").map(Number)
  const scale = Math.min(240 / heightMm, 150 / widthMm)
  const w = widthMm * scale
  const h = heightMm * scale
  const x = (200 - w) / 2
  const inset = Math.max(6, Math.min(w, h) * 0.06)
  const holes = [
    [x + inset, 16 + inset],
    [x + w - inset, 16 + inset],
    [x + inset, 16 + h - inset],
    [x + w - inset, 16 + h - inset],
  ]

  return (
    <section className="mx-auto flex max-w-[860px] flex-col gap-4 py-8">
      <h3 className="text-foreground text-center text-xl font-bold">
        {t("title")}
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <figure className="flex flex-col gap-2">
          <div className="bg-muted grid aspect-[4/5] place-items-center overflow-hidden rounded-lg">
            <svg
              viewBox="0 0 220 320"
              role="img"
              aria-label={tAll("sizeAlt", { width: widthMm, height: heightMm })}
              className="h-[92%] w-[86%]"
            >
              <rect
                x={x}
                y={16}
                width={w}
                height={h}
                className="fill-white stroke-[#757575]"
                strokeWidth={1.2}
              />
              {config.holes &&
                holes.map(([cx, cy]) => (
                  <circle
                    key={`${cx}-${cy}`}
                    cx={cx}
                    cy={cy}
                    r={Math.max(2, inset * 0.35)}
                    className="fill-[#f7f8f9] stroke-[#757575]"
                  />
                ))}
              <path
                d={`M${x} ${h + 36} H${x + w} M${x} ${h + 31} V${h + 41} M${x + w} ${h + 31} V${h + 41}`}
                className="stroke-foreground fill-none"
              />
              <text
                x={100}
                y={h + 54}
                textAnchor="middle"
                className="fill-foreground text-[11px]"
              >
                {widthMm}mm
              </text>
              <path
                d={`M${x + w + 16} 16 V${h + 16} M${x + w + 11} 16 H${x + w + 21} M${x + w + 11} ${h + 16} H${x + w + 21}`}
                className="stroke-foreground fill-none"
              />
              <text
                x={x + w + 28}
                y={16 + h / 2}
                textAnchor="middle"
                transform={`rotate(90 ${x + w + 28} ${16 + h / 2})`}
                className="fill-foreground text-[11px]"
              >
                {heightMm}mm
              </text>
            </svg>
          </div>
          <figcaption className="flex flex-col gap-1">
            <strong className="text-foreground text-base font-bold">
              {tAll("sizeCaption", {
                width: widthMm / 10,
                height: heightMm / 10,
              })}
            </strong>
            <span className="text-muted-foreground text-sm">
              {t("sizeDescription")}
            </span>
          </figcaption>
        </figure>

        <figure className="flex flex-col gap-2">
          <div
            className={
              config.throughFront
                ? "bg-muted grid aspect-[4/5] min-h-0 grid-cols-2 items-center gap-2 overflow-hidden rounded-lg p-4"
                : "bg-muted grid aspect-[4/5] min-h-0 grid-cols-1 overflow-hidden rounded-lg p-6"
            }
          >
            {thumbnail &&
              (config.throughFront ? [false, true] : [false]).map((through) => (
                <div
                  key={String(through)}
                  className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 템플릿 썸네일은 ugc 가 주는 SVG 라 next/image 최적화 대상이 아니다 */}
                  <img
                    src={thumbnail}
                    alt={tAll(through ? "backAlt" : "frontAlt")}
                    loading="lazy"
                    className={
                      through
                        ? "min-h-0 w-full flex-1 -scale-x-100 object-contain opacity-55 saturate-[.7]"
                        : "min-h-0 w-full flex-1 object-contain drop-shadow-sm"
                    }
                  />
                  {config.throughFront && (
                    <span className="text-muted-foreground text-xs">
                      {tAll(through ? "back" : "front")}
                    </span>
                  )}
                </div>
              ))}
          </div>
          <figcaption className="flex flex-col gap-1">
            <strong className="text-foreground text-base font-bold">
              {t("materialCaption")}
            </strong>
            <span className="text-muted-foreground text-sm">
              {t("materialDescription")}
            </span>
          </figcaption>
        </figure>

        <figure className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 공개 버킷의 고정 이미지 한 장이다 */}
          <img
            src={config.closeUp}
            alt={t("useAlt")}
            loading="lazy"
            className="bg-muted aspect-[4/5] w-full rounded-lg object-cover"
          />
          <figcaption className="flex flex-col gap-1">
            <strong className="text-foreground text-base font-bold">
              {t("useCaption")}
            </strong>
            <span className="text-muted-foreground text-sm">
              {t("useDescription")}
            </span>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
