"use client"

import { ChevronRight, User2 } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useUser } from "@/contexts/user-context"

export function LoginPromptBanner() {
  const { countryCode } = useParams<{ countryCode: string }>()
  const { user, isLoading } = useUser()

  // 로딩 중이거나 로그인 상태면 표시하지 않음
  if (isLoading || user) {
    return null
  }

  return (
    <Link
      href={`/${countryCode}/login`}
      className="mb-3.5 block px-4 py-2 md:container md:mx-auto md:max-w-[1360px] md:px-[40px]"
    >
      <Card className="overflow-hidden border-[0.5px] shadow-none transition-colors hover:bg-gray-50">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            {/* 유저 아이콘 영역 */}
            <Avatar className="h-12 w-12 border border-gray-100 bg-gray-50">
              <AvatarFallback className="bg-gray-200">
                <User2 className="h-6 w-6 text-gray-500" />
              </AvatarFallback>
            </Avatar>

            {/* 텍스트 영역 */}
            <div className="flex flex-col">
              <span className="text-base font-bold text-gray-900">
                비회원 님
              </span>
              <span className="text-yellow-30 decoration-yellow-30 text-sm font-medium underline underline-offset-4">
                최상의 경험을 위해 로그인 하세요
              </span>
            </div>
          </div>

          {/* 화살표 아이콘 */}
          <ChevronRight className="h-6 w-6 text-gray-300" />
        </CardContent>
      </Card>
    </Link>
  )
}
