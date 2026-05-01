import { Button } from "@/components/ui/button"
import LocalizedClientLink from "@/components/shared/localized-client-link"

export default function SignInPrompt() {
  return (
    <div className="flex items-center justify-between bg-white">
      <div>
        <h2 className="text-xl font-semibold">이미 계정이 있으신가요?</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          로그인하면 더 나은 쇼핑 경험을 누릴 수 있어요.
        </p>
      </div>
      <div>
        <LocalizedClientLink href="/account">
          <Button
            variant="outline"
            className="h-10"
            data-testid="sign-in-button"
          >
            로그인
          </Button>
        </LocalizedClientLink>
      </div>
    </div>
  )
}
