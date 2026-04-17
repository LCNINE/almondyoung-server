"use client"

import { useActionState } from "react"
import Input from "@modules/common/components/input"
import { LOGIN_VIEW } from "@modules/account/templates/login-template"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { signup } from "@lib/data/customer"
import { useParams, useSearchParams } from "next/navigation"

type Props = {
  setCurrentView: (view: LOGIN_VIEW) => void
}

const Register = ({ setCurrentView }: Props) => {
  const { countryCode } = useParams() as { countryCode: string }
  const searchParams = useSearchParams()
  const [message, formAction] = useActionState(signup, null)
  const redirectTo = searchParams.get("redirect_to") || "/"

  return (
    <div
      className="max-w-sm flex flex-col items-center"
      data-testid="register-page"
    >
      <h1 className="text-large-semi uppercase mb-6">
        Become a DF Mall Member
      </h1>
      <p className="text-center text-base-regular text-ui-fg-base mb-4">
        Create your DF Mall Member profile, and get access to an enhanced
        shopping experience.
      </p>
      <form className="w-full flex flex-col" action={formAction}>
        <input type="hidden" name="countryCode" value={countryCode} />
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <div className="flex flex-col w-full gap-y-2">
          <Input
            label="Login ID"
            name="loginId"
            required
            autoComplete="username"
            data-testid="login-id-input"
          />
          <Input
            label="Name"
            name="username"
            required
            autoComplete="name"
            data-testid="username-input"
          />
          <Input
            label="Nickname"
            name="nickname"
            required
            data-testid="nickname-input"
          />
          <Input
            label="Email"
            name="email"
            required
            type="email"
            autoComplete="email"
            data-testid="email-input"
          />
          <Input
            label="Birthday (YYYYMMDD)"
            name="birthday"
            required
            inputMode="numeric"
            pattern="\\d{8}"
            data-testid="birthday-input"
          />
          <Input
            label="Phone Number (+8210...)"
            name="phoneNumber"
            type="tel"
            autoComplete="tel"
            required
            data-testid="phone-number-input"
          />
          <Input
            label="Password"
            name="password"
            required
            type="password"
            autoComplete="new-password"
            data-testid="password-input"
          />
        </div>
        <div className="mt-6 flex flex-col gap-y-2 text-small-regular text-ui-fg-subtle">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isOver14" required />
            I am over 14 years old
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="termsOfService" required />
            I agree to the terms of service
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="electronicTransaction" required />
            I agree to the electronic transaction terms
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="privacyPolicy" required />
            I agree to the privacy policy
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="thirdPartySharing" required />
            I agree to third-party data sharing
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="marketingConsent" />
            I agree to marketing messages
          </label>
        </div>
        <ErrorMessage error={message} data-testid="register-error" />
        <span className="text-center text-ui-fg-base text-small-regular mt-6">
          By creating an account, you agree to DF Mall&apos;s{" "}
          <LocalizedClientLink
            href="/content/privacy-policy"
            className="underline"
          >
            Privacy Policy
          </LocalizedClientLink>{" "}
          and{" "}
          <LocalizedClientLink
            href="/content/terms-of-use"
            className="underline"
          >
            Terms of Use
          </LocalizedClientLink>
          .
        </span>
        <SubmitButton className="w-full mt-6" data-testid="register-button">
          Join
        </SubmitButton>
      </form>
      <span className="text-center text-ui-fg-base text-small-regular mt-6">
        Already a member?{" "}
        <button
          onClick={() => setCurrentView(LOGIN_VIEW.SIGN_IN)}
          className="underline"
        >
          Sign in
        </button>
        .
      </span>
    </div>
  )
}

export default Register
