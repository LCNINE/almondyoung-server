export function ProductPrice({
  price,
  originalPrice,
  discount,
}: {
  price: number
  originalPrice: number
  discount: number
}) {
  // 할인율이 0보다 큰 경우에만 할인 정보를 렌더링
  const hasDiscount = discount > 0

  return (
    <>
      {hasDiscount && (
        <div className="text-[13px] text-gray-400">
          <span className="font-bold">{discount}% </span>
          <span className="line-through">
            {originalPrice.toLocaleString()}원
          </span>
        </div>
      )}

      <span className="text-[16px] font-bold text-black">
        {price.toLocaleString()}원
      </span>
    </>
  )
}
