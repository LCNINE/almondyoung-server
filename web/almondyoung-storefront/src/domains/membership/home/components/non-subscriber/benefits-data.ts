import type { BenefitDetail, FAQItem } from "./benefit.types"

export const CURRENT_BENEFITS: BenefitDetail[] = [
  {
    id: "benefit-01",
    number: "01",
    title: "웰컴 멤버십!",
    description: "멤버십 가입시 누구나 100원에 제품 웰컴딜~",
  },
  {
    id: "benefit-02",
    number: "02",
    title: "멤버십가! 전제품 추가할인",
    description:
      "원가에 가장 가까운 가격! (디지털 상품 포함) (일부 브랜드 제품 제외)",
  },
  {
    id: "benefit-03",
    number: "03",
    title: "독점 상품 제공",
    description: "멤버십 회원만 구매할 수 있는 다양한 독점 상품 제공",
  },
  {
    id: "benefit-04",
    number: "04",
    title: "이벤트 및 프로모션",
    description: "멤버십 회원을 위한 특별 이벤트와 프로모션 참여 기회",
  },
  {
    id: "benefit-05",
    number: "05",
    title: "예약관리 어플 무료사용",
    description:
      "다양한 예약 플랫폼들의 장점만 모은 효율적인 예약관리 시스템",
  },
  {
    id: "benefit-06",
    number: "06",
    title: "렌탈서비스 제공",
    description: "고가의 미용 장비를 저렴하게 일 단위로 렌탈 제공",
  },
  {
    id: "benefit-07",
    number: "07",
    title: "무료 디지털 템플릿 제공",
    description:
      "멤버십만을 위한 다양한 무료 디지털 템플릿 무제한 다운로드",
  },
  {
    id: "benefit-08",
    number: "08",
    title: "매월 이달의 쿠폰 제공",
    description: "멤버십 회원을 위한 다양한 특별 쿠폰 제공!",
  },
]

export const UPCOMING_BENEFITS: BenefitDetail[] = [
  {
    id: "benefit-09",
    number: "09",
    title: "당일 배송, 당일 도착",
    description:
      "(서울 전지역, 경기&인천 일부지역만) 그 외 지역 확장예정",
    isUpcoming: true,
  },
  {
    id: "benefit-10",
    number: "10",
    title: "OTT 서비스",
    description:
      "각종 미용 스킬과 샵 운영에 도움되는 동영상 시리즈 제공",
    isUpcoming: true,
  },
  {
    id: "benefit-11",
    number: "11",
    title: "낱개 구매",
    description:
      "펌제, 니들 등 한번쯤 써보고 싶었으나 부담되었던 제품들을 낱개로 구매 가능한 혜택",
    isUpcoming: true,
  },
  {
    id: "benefit-12",
    number: "12",
    title: "베드쉐어 서비스",
    description:
      "시술 공간이 필요한 원장님들에게 베드 공유 서비스 제공",
    isUpcoming: true,
  },
  {
    id: "benefit-13",
    number: "13",
    title: "샵 인테리어 플래닝",
    description:
      "전문 공간 디자이너가 원장님 샵 사진을 3D 모델링하여 인테리어 도움 제공",
    isUpcoming: true,
  },
  {
    id: "benefit-14",
    number: "14",
    title: "무료 샘플 제공",
    description:
      "우수한 제조사의 신제품, 인기제품 샘플을 무료 제공",
    isUpcoming: true,
  },
  {
    id: "benefit-15",
    number: "15",
    title: "카드페이 서비스",
    description: "월세 및 인건비 할부 결제 기능 제공",
    isUpcoming: true,
  },
  {
    id: "benefit-16",
    number: "16",
    title: "캐시 체인(추천인)",
    description:
      "내 추천인 코드로 가입한 회원이 제품을 구매할 때마다 일정 퍼센트가 포인트로 적립! (현금인출 or 제품구매 가능)",
    isUpcoming: true,
  },
]

export const FAQ_DATA: FAQItem[] = [
  {
    question: "아몬드영 멤버십은 무엇인가요?",
    answer:
      "아몬드영 멤버십은 '구독형 서비스'로 월 4,990원에 다양하고 특별한 혜택과을 만나실 수 있는 등급 입니다.",
  },
  {
    question: "어떤 콘텐추가 추가되나요?",
    answer:
      "아몬드영은 '곧 만날 출시 예정 혜택' 외에도, 더 많은 가치를 제공하기 위해 지속적으로 새로운 콘텐츠를 추가해 나갈 예정입니다.",
  },
  {
    question: "멤버십은 얼마에 이용할 수 있나요?",
    answer:
      "월 4,990원 또는 연 49,900원(2개월무료)으로, 현재 제공되는 혜택만으로도 5,000원 이상의 가치를 보장합니다.",
  },
  {
    question: "결제는 어떻게 이루어질까요?",
    answer:
      "체크카드 or 신용카드 자동결제 서비스를 통하여 이용 가능하며 언제든지 결제수단 변경이 가능합니다.",
  },
  {
    question: "해지는 어떻게 할까요?",
    answer:
      "마이페이지의 멤버십에서 해지할 수 있으며, 해지 시 이용 월 말일까지 정상적으로 서비스를 이용하실 수 있습니다. 이후 자동으로 종료됩니다",
  },
]
