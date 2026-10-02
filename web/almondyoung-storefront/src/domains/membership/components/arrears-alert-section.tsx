import { getMyArrears } from "@/lib/api/membership"
import ArrearsAlert from "./arrears-alert"

/**
 * 홈처럼 «이 알림 때문에 본문이 기다려서는 안 되는» 화면에서 쓴다. Suspense 안에 두면 조회가
 * 끝날 때까지 나머지가 먼저 그려진다.
 *
 * 마이페이지는 이 컴포넌트를 쓰지 않는다 — 거기는 모바일·데스크탑 두 벌을 둘 다 마운트해서
 * 자기 조회를 하면 같은 조회가 두 번 나간다. 그 화면은 한 번 조회해 값을 내려준다.
 */
export default async function ArrearsAlertSection({
  className,
}: {
  className?: string
}) {
  const { outstanding } = await getMyArrears()
  return <ArrearsAlert total={outstanding.total} className={className} />
}
