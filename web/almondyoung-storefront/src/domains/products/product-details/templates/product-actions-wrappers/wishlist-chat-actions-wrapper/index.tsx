import { getWishlistByProductId } from "@/lib/api/users/wishlist"
import { Customer } from "@/lib/types/ui/medusa"
import { WishlistButton } from "../../../components/actions/wishlist-button"
// import { ChatButton } from "./chat-button"

interface Props {
  productId: string
  countryCode: string
  customer: Customer | null
}

export async function WishlistChatActionsWrapper({
  productId,
  countryCode,
  customer,
}: Props) {
  const wishlist = customer
    ? await getWishlistByProductId(productId).catch(() => null)
    : null

  return (
    <div className="flex items-center gap-2">
      <WishlistButton
        productId={productId}
        isWishlisted={!!wishlist}
        countryCode={countryCode}
      />
      {/* <ChatButton /> */}
    </div>
  )
}
