import { redirect } from "next/navigation"

const LEGACY_ORDER_LIST_URL =
  process.env.NEXT_PUBLIC_LEGACY_ORDER_LIST_URL ??
  "https://almondyoung.com/myshop/order/list.html"

export default function LegacyOrderRedirectPage() {
  redirect(LEGACY_ORDER_LIST_URL)
}
