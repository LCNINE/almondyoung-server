"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Shield } from "lucide-react"

interface AdminAccessButtonProps {
  countryCode: string
  className?: string
}

/**
 * 관리자 접근 버튼
 * accessToken의 scope가 master 또는 admin인 경우에만 표시
 */
export function AdminAccessButton({ countryCode, className }: AdminAccessButtonProps) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={className}
    >
      <Link href={`/${countryCode}/mypage/admin/inventory`}>
        <Shield className="mr-2 h-4 w-4" />
        재고 관리
      </Link>
    </Button>
  )
}

