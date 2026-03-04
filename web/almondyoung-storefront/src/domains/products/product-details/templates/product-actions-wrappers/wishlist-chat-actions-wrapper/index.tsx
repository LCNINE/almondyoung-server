import { getWishlistByProductId } from "@/lib/api/users/wishlist"
import { WishlistButton } from "../../../components/actions/wishlist-button"
// import { ChatButton } from "./chat-button"

interface Props {
  productId: string
  countryCode: string
}

export async function WishlistChatActionsWrapper({
  productId,
  countryCode,
}: Props) {
  const wishlist = await getWishlistByProductId(productId).catch(() => null)

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
