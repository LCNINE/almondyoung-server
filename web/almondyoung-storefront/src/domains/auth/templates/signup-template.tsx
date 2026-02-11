import type { Cafe24SignupBootstrapData } from "@lib/api/users/auth/signup-cafe24"
import { SignupForm } from "../components/signup/signup-form"

interface SignupTemplateProps {
  mode: "default" | "cafe24"
  cafe24Bootstrap: Cafe24SignupBootstrapData | null
}

export default function SignupTemplate({
  mode,
  cafe24Bootstrap,
}: SignupTemplateProps) {
  return (
    <section className="flex w-full max-w-[500px] py-6 md:py-0">
      <SignupForm mode={mode} cafe24Bootstrap={cafe24Bootstrap} />
    </section>
  )
}
