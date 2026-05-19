"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Heart } from "lucide-react"
import { useTranslations } from "next-intl"
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
  const t = useTranslations("productDetail.summary")
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
        router.refresh()
        if (nextWishlisted) {
          showActionToast({
            icon: (
              <Heart className="h-7 w-7" fill="currentColor" strokeWidth={0} />
            ),
            label: t("wishlistToast"),
          })
        } else {
          showActionToast({
            icon: <Heart className="h-7 w-7" strokeWidth={2.5} />,
            label: t("wishlistToast"),
            variant: "default",
          })
        }
      } catch (error) {
        console.error("wishlist toggle failed", error)
        toast.error(t("wishlistFail"))
      }
    })
  }

  return (
    <Button
      variant="ghost"
      onClick={handleToggle}
      disabled={disabled || isPending}
      aria-label={t("wishlistAria")}
      className="cursor-pointer hover:bg-transparent"
    >
      <AnimatedHeart isActive={optimisticWishlisted} className="h-7 w-7" />
    </Button>
  )
}
