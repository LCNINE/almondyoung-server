import React from "react"
// 사용하는 컴포넌트들을 import 합니다. 실제 경로에 맞게 수정해주세요.
import {
  OrderInfoCardRoot,
  OrderInfoCardTitle,
  OrderInfoCardRow,
  OrderInfoCardRowItem,
  OrderInfoCardDivider,
} from "./order-info-card.atomic"
import { CustomButton } from "../shared/custom-buttons/custom-button"

/**
 * 배송지 정보 카드 컴포넌트
 */
export const OrderInfoCardShipping = () => {
  return (
    <OrderInfoCardRoot>
      <OrderInfoCardTitle>이연정</OrderInfoCardTitle>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>받는분</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>이연정</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>
          (10303) 서울특별시 강북구 도봉로 89길 27(수유동) 4층
        </OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>전화번호</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>010-0000-0000</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardDivider />
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>배송요청사항</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>부재 시 문앞에 두주세요.</OrderInfoCardRowItem>
      </OrderInfoCardRow>
    </OrderInfoCardRoot>
  )
}

/**
 * 결제 정보 카드 컴포넌트
 */
export const OrderInfoCardPayment = () => {
  return (
    <OrderInfoCardRoot>
      <OrderInfoCardTitle>결제정보</OrderInfoCardTitle>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 상품금액</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>100,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 배송비</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>10,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardDivider />
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>결제수단 · 네이버페이</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>110,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 결제금액</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>110,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
    </OrderInfoCardRoot>
  )
}

/**
 * 최종 정보 확인 카드 컴포넌트
 */
export const OrderInfoCardFinal = () => {
  return (
    <OrderInfoCardRoot>
      <OrderInfoCardRow variant="gap" gap={52}>
        <OrderInfoCardRowItem>받는사람</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>홍길동</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow variant="gap" gap={52}>
        <OrderInfoCardRowItem>받는주소</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>
          (10303) 서울특별시 강북구 도봉로 89길 27(수유동) 4층
        </OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow variant="gap" gap={28}>
        <OrderInfoCardRowItem>배송요청사항</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>부재 시 문앞에 두주세요.</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardDivider />
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 상품가격</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>100,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 배송비</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>10,000원</OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <OrderInfoCardDivider />
      <OrderInfoCardRow>
        <OrderInfoCardRowItem>총 결제금액</OrderInfoCardRowItem>
        <OrderInfoCardRowItem>
          <span className="mr-[4px]">펌뱅킹/익월 이체</span>
          <span className="text-primary text-[14px] font-bold">110,000원</span>
        </OrderInfoCardRowItem>
      </OrderInfoCardRow>
      <CustomButton variant="ghost" fullWidth color="gray">
        주문내역 보기
      </CustomButton>
    </OrderInfoCardRoot>
  )
}
