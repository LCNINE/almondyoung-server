import type {
  SaleComponent,
  SaleLayout,
  TimeSaleSettings,
} from "@packages/domain-types/time-sale"

const INK = "#141617"
const MINT = "#36c2b3"
const PINK_DEEP = "#c2306c"

function brandComponent(c: SaleComponent): SaleComponent {
  if (c.type === "grid" || c.type === "carousel") {
    return {
      ...c,
      options: {
        ...c.options,
        badgeColor: PINK_DEEP,
        discountCss: { ...c.options.discountCss, color: PINK_DEEP },
      },
    }
  }

  if (c.type === "tabs" && c.options.activeTabCss?.borderBottom) {
    return {
      ...c,
      options: {
        ...c.options,
        activeTabCss: {
          ...c.options.activeTabCss,
          color: INK,
          borderBottom: `2px solid ${MINT}`,
        },
      },
    }
  }

  return c
}

function brandLayout(layout: SaleLayout): SaleLayout {
  return { ...layout, components: layout.components.map(brandComponent) }
}

/**
 * 타임세일 모양은 어드민이 저장한 설정(Store.metadata)대로 그리되, 색만 새 로고 역할 색으로 맞춘다.
 * 시간 배지와 할인율은 pink-deep, 밑줄 탭의 활성 밑줄은 mint, 활성 글자는 ink.
 */
export function withBrandColors(settings: TimeSaleSettings): TimeSaleSettings {
  const { main, more } = settings.styles

  return {
    ...settings,
    styles: {
      main: { pc: brandLayout(main.pc), mobile: brandLayout(main.mobile) },
      more: { pc: brandLayout(more.pc), mobile: brandLayout(more.mobile) },
    },
  }
}
