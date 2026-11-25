import { PRINT_PRODUCTS, PRINT_SPECS, type PrintKind } from "./catalog"

// 와우프레스 상품 페이지의 접수 가능 파일(2026-11-23 확인). core print-source.ts 의 CUSTOMER_FILE_EXTENSIONS 와 같아야 한다.
// 현수막(window)은 페이지 표기와 이전 답변이 달라 확인 전까지 받지 않고, 디플로마는 와우프레스 상품이 없다
export const CUSTOMER_FILE_EXTENSIONS: Partial<
  Record<PrintKind, readonly string[]>
> = {
  card: ["pdf", "ai", "eps"],
  bizcard: ["pdf", "ai", "eps"],
  nail: ["pdf", "ai", "eps"],
  pet: ["ai", "eps", "jpg", "jpeg", "png"],
  mini: ["ai", "eps"],
  menu: ["ai", "eps"],
  invitation: ["pdf", "ai", "eps"],
}

export const CUSTOMER_FILE_MAX_BYTES = 300 * 1024 * 1024

export const customerFileExtensions = (kind: PrintKind): readonly string[] =>
  CUSTOMER_FILE_EXTENSIONS[kind] ?? []

export const acceptsCustomerFile = (kind: PrintKind): boolean =>
  customerFileExtensions(kind).length > 0

export const formatsLabel = (extensions: readonly string[]): string =>
  extensions
    .filter((extension) => extension !== "jpeg")
    .map((extension) => extension.toUpperCase())
    .join(" · ")

export type CustomerFileProblem = "type" | "size"

export function fileProblem(
  extensions: readonly string[],
  file: { name: string; size: number }
): CustomerFileProblem | null {
  const extension = file.name.includes(".")
    ? (file.name.split(".").pop()?.toLowerCase() ?? "")
    : ""

  if (!extensions.includes(extension)) {
    return "type"
  }

  return file.size > CUSTOMER_FILE_MAX_BYTES ? "size" : null
}

export const customerFileProblem = (
  kind: PrintKind,
  file: { name: string; size: number }
): CustomerFileProblem | null => fileProblem(customerFileExtensions(kind), file)

// 고정 목록(PRINT_PRODUCTS)의 상품은 디자인이 끝난 완성품이라 시안·파일 없이도 산다.
// 템플릿으로 게시한 상품은 주문제작이라 시안이나 고객 파일이 있어야 인쇄할 것이 생긴다
export const isMadeToOrder = (productId: string): boolean =>
  !(productId in PRINT_PRODUCTS)

export type PrintFileSpec = ReturnType<typeof printFileSpec>

export function printFileSpec(kind: PrintKind, size: [number, number]) {
  const spec = PRINT_SPECS[kind]
  const [width, height] = size

  return {
    cut: { width, height },
    work: {
      width: width + spec.bleedMm * 2,
      height: height + spec.bleedMm * 2,
    },
    safetyMm: spec.safetyMm,
    duplex: spec.duplex,
  }
}
