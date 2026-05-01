import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import { AccountFindIdForm } from "domains/auth/components/account-find"

export default function FindIdPage() {
  return (
    <>
      <MobileBackHeader title="아이디찾기" />
      <AccountFindIdForm />
    </>
  )
}
