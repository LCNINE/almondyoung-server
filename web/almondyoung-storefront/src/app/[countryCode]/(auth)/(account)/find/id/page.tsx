import { AccountFindIdForm } from "@components/auth/components/account-find"
import { MobileBackHeader } from "@components/layout/components/header"

export default function FindIdPage() {
  return (
    <>
      <MobileBackHeader title="아이디찾기" />
      <AccountFindIdForm />
    </>
  )
}
