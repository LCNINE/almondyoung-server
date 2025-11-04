import React from "react"
// 사용하는 풀네임 컴포넌트들을 import 합니다. 실제 경로에 맞게 수정해주세요.
import {
  ShipmentProductCardRoot,
  ShipmentProductCardThumbnail,
  ShipmentProductCardInfo,
  ShipmentProductCardOrderNumber,
  ShipmentProductCardStatus,
  ShipmentProductCardRight,
} from "./shipment-product-card.atomic"

/**
 * 가장 기본 형태의 배송 상품 카드 컴포넌트 (썸네일 + 주문번호 + "배송 중")
 */
export const ShipmentProductCardDefault = () => {
  return (
    <ShipmentProductCardRoot>
      <ShipmentProductCardThumbnail src="https://placehold.co/600x400/png" />
      <ShipmentProductCardInfo>
        <ShipmentProductCardOrderNumber>
          주문번호 20102-202031
        </ShipmentProductCardOrderNumber>
        <ShipmentProductCardStatus>배송 중</ShipmentProductCardStatus>
      </ShipmentProductCardInfo>
    </ShipmentProductCardRoot>
  )
}

/**
 * 오른쪽에 커스텀 아이콘(또는 컴포넌트)을 넣은 배송 상품 카드 컴포넌트
 */
export const ShipmentProductCardWithCustomRightIcon = () => {
  return (
    <ShipmentProductCardRoot>
      <ShipmentProductCardThumbnail src="https://placehold.co/600x400/png" />
      <ShipmentProductCardInfo>
        <ShipmentProductCardOrderNumber>
          주문번호 20232-202031
        </ShipmentProductCardOrderNumber>
        <ShipmentProductCardStatus>배송 중</ShipmentProductCardStatus>
      </ShipmentProductCardInfo>
      <ShipmentProductCardRight>
        <span className="text-primary-500 text-sm">상세보기</span>
      </ShipmentProductCardRight>
    </ShipmentProductCardRoot>
  )
}
