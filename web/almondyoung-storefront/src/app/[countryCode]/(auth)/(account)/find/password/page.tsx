import { MobileBackHeader } from "@/components/layout/header"
import { AccountFindPwForm } from "domains/auth/components/account-find"

export default function FindPasswordPage() {
  return (
    <>
      <MobileBackHeader title="비밀번호찾기" />
      <AccountFindPwForm />
    </>
  )
}
