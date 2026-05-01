"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Heart } from "lucide-react"
import { showActionToast } from "@/components/shared/action-toast"
import { AnimatedHeart } from "@/components/shared/animated-heart"
import { Button } from "@/components/ui/button"
import { useUser } from "@/contexts/user-context"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { toggleWishlist } from "@lib/api/users/wishlist"
import { toast } from "sonner"

interface Props {
  productId: string
  isWishlisted: boolean
  countryCode: string
  disabled?: boolean
}

export function WishlistButton({
  productId,
  isWishlisted,
  countryCode,
  disabled,
}: Props) {
  const { user } = useUser()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [optimisticWishlisted, setOptimisticWishlisted] =
    useOptimistic(isWishlisted)
  const handleToggle = () => {
    if (!user) {
      const path = getPathWithoutCountry(countryCode)
      router.push(
        `${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
      )
      return
    }

    const nextWishlisted = !optimisticWishlisted
    startTransition(async () => {
      setOptimisticWishlisted(nextWishlisted)
      try {
        await toggleWishlist(productId)
        if (nextWishlisted) {
          showActionToast({
            icon: (
              <Heart className="h-7 w-7" fill="currentColor" strokeWidth={0} />
            ),
            label: "좋아요",
          })
        } else {
          // 좋아요 취소
          showActionToast({
            icon: <Heart className="h-7 w-7" strokeWidth={2.5} />,
            label: "좋아요",
            variant: "default",
          })
        }
      } catch (error) {
        console.error("찜하기 실패", error)
        // 실패 시 optimistic 값은 자동으로 isWishlisted(원래 값)로 롤백됨
        toast.error("처리 중 오류가 발생했습니다.")
      }
    })
  }

  return (
    <Button
      variant="ghost"
      onClick={handleToggle}
      disabled={disabled || isPending}
      aria-label="관심 상품 등록"
      className="cursor-pointer hover:bg-transparent"
    >
      <AnimatedHeart isActive={optimisticWishlisted} className="h-7 w-7" />
    </Button>
  )
}
