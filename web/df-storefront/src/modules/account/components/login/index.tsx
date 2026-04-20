"use client"

import { login } from "@lib/data/customer"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import { useActionState } from "react"
import { useParams, useSearchParams } from "next/navigation"

const Login = () => {
  const { countryCode } = useParams() as { countryCode: string }
  const searchParams = useSearchParams()
  const [message, formAction] = useActionState(login, null)
  const redirectTo = searchParams.get("redirect_to") || "/"

  return (
    <div
      className="max-w-sm w-full flex flex-col items-center"
      data-testid="login-page"
    >
      <h1 className="text-large-semi uppercase mb-6">Welcome back</h1>
      <p className="text-center text-base-regular text-ui-fg-base mb-8">
        통합 계정으로 로그인하고 쇼핑을 이어가세요.
      </p>
      <form className="w-full" action={formAction}>
        <input type="hidden" name="countryCode" value={countryCode} />
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <ErrorMessage error={message} data-testid="login-error-message" />
        <SubmitButton data-testid="sign-in-button" className="w-full mt-6">
          로그인하기
        </SubmitButton>
      </form>
    </div>
  )
}

export default Login
