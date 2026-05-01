import type { QuestionCategory } from "@/lib/types/dto/ugc"

interface SubCategory {
  value: string
  label: string
}

interface CategoryConfig {
  value: QuestionCategory
  label: string
  subCategories: SubCategory[]
}

export const INQUIRY_CATEGORIES: CategoryConfig[] = [
  {
    value: "delivery",
    label: "배송",
    subCategories: [
      { value: "status", label: "배송 현황 문의" },
      { value: "address_change", label: "배송지 변경" },
      { value: "delay", label: "배송 지연" },
      { value: "etc", label: "기타" },
    ],
  },
  {
    value: "order",
    label: "주문/결제",
    subCategories: [
      { value: "cancel", label: "주문 취소" },
      { value: "change", label: "주문 변경" },
      { value: "payment_error", label: "결제 오류" },
      { value: "refund", label: "환불 문의" },
      { value: "etc", label: "기타" },
    ],
  },
  {
    value: "exchange",
    label: "교환/반품",
    subCategories: [
      { value: "exchange_request", label: "교환 신청" },
      { value: "return_request", label: "반품 신청" },
      { value: "exchange_status", label: "교환/반품 현황" },
      { value: "etc", label: "기타" },
    ],
  },
  {
    value: "product",
    label: "상품",
    subCategories: [
      { value: "info", label: "상품 정보 문의" },
      { value: "restock", label: "재입고 문의" },
      { value: "defect", label: "불량/파손 문의" },
      { value: "etc", label: "기타" },
    ],
  },
  {
    value: "account",
    label: "회원/계정",
    subCategories: [
      { value: "info_change", label: "회원 정보 변경" },
      { value: "withdraw", label: "회원 탈퇴" },
      { value: "point", label: "적립금/포인트 문의" },
      { value: "etc", label: "기타" },
    ],
  },
  {
    value: "etc",
    label: "기타",
    subCategories: [
      { value: "suggestion", label: "서비스 개선 제안" },
      { value: "partnership", label: "제휴/협력 문의" },
      { value: "etc", label: "기타" },
    ],
  },
]

export const getCategoryLabel = (categoryValue: QuestionCategory): string => {
  return (
    INQUIRY_CATEGORIES.find((c) => c.value === categoryValue)?.label ??
    categoryValue
  )
}

export const getSubCategoryLabel = (
  categoryValue: QuestionCategory,
  subCategoryValue: string
): string => {
  const category = INQUIRY_CATEGORIES.find((c) => c.value === categoryValue)
  return (
    category?.subCategories.find((s) => s.value === subCategoryValue)?.label ??
    subCategoryValue
  )
}
