import { AccountFindPwForm } from "@components/auth/components/account-find"
import { MobileBackHeader } from "@components/layout/components/header"

export default function FindPasswordPage() {
  return (
    <>
      <MobileBackHeader title="비밀번호찾기" />
      <AccountFindPwForm />
    </>
  )
}
