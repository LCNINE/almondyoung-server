import { redirect } from "next/navigation"

const LEGACY_MEMBERSHIP_HISTORY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://almondyoung.com/myshop/mileage/historyList.html"

export default function LegacyMembershipRedirectPage() {
  redirect(LEGACY_MEMBERSHIP_HISTORY_URL)
}
