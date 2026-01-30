import { fetchMe } from "@lib/api/users/me"
import { getPinStatus } from "@/lib/api/wallet"
import PinChangeForm from "domains/payment/components/security-pin/pin-change-form"
import PinSetupForm from "domains/payment/components/security-pin/pin-setup-form"
import PhoneVerificationForPin from "./phone-verification-for-pin"

export default async function SecurityManager({
  redirectTo,
}: {
  redirectTo: string
}) {
  const [currentUser, pinStatus] = await Promise.all([
    fetchMe(),
    getPinStatus(),
  ])

  // 휴대폰 인증 안 되어 있으면 인라인 전화번호 인증
  if (!currentUser.profile?.phoneNumber) {
    return <PhoneVerificationForPin redirectTo={redirectTo} />
  }

  // 새로 등록
  if (pinStatus.status === "NONE") {
    return <PinSetupForm redirectTo={redirectTo} />
  }

  // PIN 변경
  if (pinStatus.status === "ACTIVE") {
    return <PinChangeForm />
  }

  return null
}
