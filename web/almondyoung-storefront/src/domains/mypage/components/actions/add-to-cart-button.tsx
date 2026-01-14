"use client"

interface AddToCartButtonProps {
  className?: string
  children?: React.ReactNode
}

export function AddToCartButton({
  className = "self-start rounded-[5px] border border-gray-300 px-4 py-2 text-[14px] hover:bg-gray-50",
  children = "장바구니 담기",
}: AddToCartButtonProps) {
  const handleAddToCart = () => {
    // TODO: 실제 장바구니 추가 로직 구현
    console.log("장바구니에 추가")
  }

  return (
    <button className={className} onClick={handleAddToCart}>
      {children}
    </button>
  )
}
