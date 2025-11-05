import { SignupForm } from "../components/signup"

export default function SignupTemplate() {
  return (
    <section className="flex md:min-h-lvh w-full max-w-[375px] flex-col justify-center px-4 pt-16 md:pt-0">
      <h2 className="section-title hidden md:block">회원가입</h2>

      <p className="md:py-12 py-4 font-medium">회원정보를 입력해주세요</p>

      <SignupForm />
    </section>
  )
}
