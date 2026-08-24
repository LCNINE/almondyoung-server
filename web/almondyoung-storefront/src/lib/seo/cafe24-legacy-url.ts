export type LegacyTarget =
  | { kind: "product"; value: string }
  | { kind: "category"; value: string }
  | { kind: "search"; value: string }

const CAFE24_PAGES = new Set(["detail.html", "list.html", "search.html"])

export function parseCafe24LegacyUrl(
  pathname: string,
  searchParams: URLSearchParams
): LegacyTarget | undefined {
  const segments = pathname.split("/").filter(Boolean)
  const [root, second] = segments

  if (root === "product") {
    if (second === "detail.html") {
      const no = searchParams.get("product_no")
      return no && /^\d+$/.test(no) ? { kind: "product", value: no } : undefined
    }
    if (second === "list.html") {
      const no = searchParams.get("cate_no")
      return no && /^\d+$/.test(no) ? { kind: "category", value: no } : undefined
    }
    if (second === "search.html") {
      const keyword = searchParams.get("keyword")
      return keyword ? { kind: "search", value: keyword } : undefined
    }
    // /product/{slug}/{product_no}/category/{cate_no}/display/{n}
    if (second && !CAFE24_PAGES.has(second) && /^\d+$/.test(segments[2] ?? "")) {
      return { kind: "product", value: segments[2] }
    }
    return undefined
  }

  // /category/{slug}/{cate_no}/{anything}
  if (root === "category" && /^\d+$/.test(segments[2] ?? "")) {
    return { kind: "category", value: segments[2] }
  }

  return undefined
}
