"use client"

import { Button } from "@components/common/ui/button"
import { ArrowLeft, Home } from "lucide-react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import NotfoundImage from "../assets/images/404-notfound.png"

const funMessages = [
  "앗, 아몬드가 길을 잃었어요!",
  "여기엔 아무것도 없네요...",
  "페이지가 숨바꼭질 중이에요!",
  "이런, 잘못된 길로 들어왔나봐요!",
]

export default function NotFound() {
  const pathname = usePathname()
  const router = useRouter()
  const [message] = useState(
    () => funMessages[Math.floor(Math.random() * funMessages.length)]
  )

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-border bg-foreground border-b">
        <div className="container mx-auto flex h-14 items-center px-4">
          <span className="text-background text-lg font-bold tracking-tight">
            ALMOND YOUNG
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg text-center">
          {/* Illustration */}
          <div className="animate-fade-in mb-6">
            <Image
              src={NotfoundImage}
              alt="길을 잃은 아몬드 캐릭터"
              width={192}
              height={192}
              className="mx-auto h-48 w-48 object-contain transition-transform duration-300 hover:scale-105"
            />
          </div>

          {/* Error Code with Animation */}
          <div
            className="animate-fade-in mb-4"
            style={{ animationDelay: "0.1s" }}
          >
            <span className="text-gold text-7xl font-bold">404</span>
          </div>

          {/* Fun Message */}
          <h1
            className="text-foreground animate-fade-in mb-3 text-xl font-semibold"
            style={{ animationDelay: "0.2s" }}
          >
            {message}
          </h1>

          <p
            className="text-muted-foreground animate-fade-in mb-2 text-sm leading-relaxed"
            style={{ animationDelay: "0.3s" }}
          >
            걱정 마세요, 누구나 가끔은 길을 잃을 수 있잖아요.
          </p>
          <p
            className="text-muted-foreground animate-fade-in mb-8 text-sm"
            style={{ animationDelay: "0.4s" }}
          >
            아래 버튼을 눌러 다시 쇼핑을 시작해 보세요! 🌰
          </p>

          {/* Action Buttons */}
          <div
            className="animate-fade-in flex flex-col gap-3 sm:flex-row sm:justify-center"
            style={{ animationDelay: "0.5s" }}
          >
            <Button
              variant="default"
              size="lg"
              className="w-full cursor-pointer sm:w-auto"
              onClick={() => router.replace("/")}
            >
              <Home className="h-4 w-4" />
              홈으로 돌아가기
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="hover:bg-gray-10 hover:text-gray-90 w-full cursor-pointer sm:w-auto"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-4 w-4" />
              이전 페이지
            </Button>
          </div>

          {/* Additional Help */}
          <div
            className="bg-surface animate-fade-in mt-10 rounded-lg p-4"
            style={{ animationDelay: "0.6s" }}
          >
            <p className="text-muted-foreground text-xs">
              혹시 찾으시는 페이지가 있으신가요?
              <br />
              <span className="text-foreground font-medium">고객센터</span>로
              문의해 주시면 빠르게 도와드릴게요.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-border border-t py-6">
        <div className="container mx-auto px-4 text-center">
          <p className="text-muted-foreground text-xs">
            © {new Date().getFullYear()} ALMOND YOUNG. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
