import LocalizedClientLink from "@components/common/localized-client-link"
import { Separator } from "@components/common/ui/separator"
import { LoginForm } from "../components/login"
import Image from "next/image"

export default function LoginTemplate() {
  return (
    <div className="flex min-h-lvh max-w-[320px] w-full flex-col justify-center ">
      {/* TODO: 추후 svg로 변경해서 아몬드 로고쪽에 애니메이션 효과 주면 좋을듯 */}
      <LocalizedClientLink href="/" className="mb-16">
        <Image
          src="/images/almond-logo-blakc 3.png"
          alt="login logo"
          width={280}
          height={26}
          className="flex items-center justify-center mx-auto"
        />
      </LocalizedClientLink>

      <LoginForm />

      <div className="text-gray-70 flex items-center justify-around space-x-4 pt-3.5 text-center text-xs">
        <LocalizedClientLink href="/auth/find/id" className="flex-1">
          아이디찾기
        </LocalizedClientLink>

        <Separator orientation="vertical" className="h-3" />

        <LocalizedClientLink href="/auth/find/password" className="flex-1">
          비밀번호찾기
        </LocalizedClientLink>

        <Separator orientation="vertical" className="h-3" />

        <LocalizedClientLink href="/auth/signup" className="flex-1">
          회원가입
        </LocalizedClientLink>
      </div>
    </div>
  )
}
