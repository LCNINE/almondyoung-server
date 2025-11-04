import OrderCard from "@components/orders/order-card/order-card"
import OrderCardContent from "@components/orders/order-card/order-card-content"
import Link from "next/link"

// 마이페이지용 간단한 배송 중 상품 데이터
const SHIPPING_ITEMS = [
  {
    id: 1,
    status: "preparing" as const,
    guaranteeLabel: "당일 출고 보장",
    products: [
      {
        id: 1,
        image: "https://via.placeholder.com/80",
        title: "노몬드 속눈썹 영양제 블랙",
        price: "9,000원",
        quantity: "2개",
        options: ["브러쉬 타입 1개", "마스카라 타입 1개"],
      },
    ],
  },
  {
    id: 2,
    status: "shipping" as const,
    guaranteeLabel: "당일 출고 보장",
    products: [
      {
        id: 2,
        image: "https://via.placeholder.com/80",
        title: "오샤레 킹 파우더 3.4g 점도 조절제",
        price: "10,000원",
        quantity: "1개",
      },
    ],
  },
]

export function ShippingItemsSection() {
  return (
    <section
      aria-labelledby="shipping-items-heading"
      className="bg-background mt-6 rounded-lg p-8"
    >
      <OrderCardContent
        status={"배송 중"}
        deliveryInfo={"6/18(화) 도착"}
        shippingNote={"문 앞 배송"}
        productName={"초경량 하이킹 백팩 25L (블랙)"}
        productImage={"/images/backpack.jpg"}
        price={"89,000원"}
        quantity={1}
        options={["블랙"]}
        showInquiry={true}
      />
    </section>
  )
}
