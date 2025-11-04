import SignupTemplate from "@components/auth/templates/signup-template"
import { MobileBackHeader } from "@components/layout/components/header"
import Link from "next/link"

export default async function SignupPage() {
  return (
    <>
      <MobileBackHeader title="회원가입" />
      <SignupTemplate />
      <Link href={`/`}>홈으로 가기</Link>
    </>
  )
}
