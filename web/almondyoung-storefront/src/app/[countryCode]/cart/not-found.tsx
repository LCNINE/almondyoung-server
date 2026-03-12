import { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { ShoppingCart } from "lucide-react"

export const metadata: Metadata = {
  title: "장바구니를 찾을 수 없습니다",
  description: "요청하신 장바구니를 찾을 수 없습니다",
}

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col items-center justify-center gap-6 px-4">
      <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
        <ShoppingCart className="text-muted-foreground h-10 w-10" />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-foreground text-2xl font-semibold">
          장바구니를 찾을 수 없습니다
        </h1>
        <p className="text-muted-foreground text-sm">
          요청하신 장바구니가 존재하지 않거나 만료되었습니다.
        </p>
      </div>
      <Button asChild>
        <Link href="/">쇼핑 계속하기</Link>
      </Button>
    </div>
  )
}
