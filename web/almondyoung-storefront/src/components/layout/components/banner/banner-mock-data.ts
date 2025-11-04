import { Slide } from './banner-carousel';

export const bannerMockData: Slide[] = [
  {
    id: 1,
    image: {
      src: "/banners/chuseok.jpg",
      alt: "추석 명화 선물세트",
      priority: true,
    },
    title: "올추석 명화를 선물해보세요",
    subtitle: "품격있는 생활품 선물세트",
    href: "/collection/chuseok",
    ctaLabel: "기획전 보러가기",
    className: "bg-neutral-900",
  },
  {
    id: 2,
    image: { 
      src: "/banners/beauty.jpg", 
      alt: "뷰티 기프트" 
    },
    title: "가벼운 마음으로, 센스있는 선물",
    subtitle: "스테디셀러를 골라 담은 합리적 구성",
    href: "/gift",
    ctaLabel: "베스트 선물",
  },
  {
    id: 3,
    image: { 
      src: "/banners/lifestyle.jpg", 
      alt: "라이프스타일 기획" 
    },
    title: "라이프스타일을 채우는 디테일",
    subtitle: "우리 집 루틴을 바꾸는 작은 변화",
    href: "/lifestyle",
    ctaLabel: "전체 보기",
  },
  {
    id: 4,
    image: { 
      src: "/banners/sale.jpg", 
      alt: "세일 이벤트" 
    },
    title: "특가 세일 진행중",
    subtitle: "최대 50% 할인된 특별가",
    href: "/sale",
    ctaLabel: "세일 상품 보기",
    className: "bg-red-900",
  },
  {
    id: 5,
    image: { 
      src: "/banners/new.jpg", 
      alt: "신상품 출시" 
    },
    title: "새로운 시즌의 시작",
    subtitle: "최신 트렌드를 반영한 신상품",
    href: "/new",
    ctaLabel: "신상품 둘러보기",
  },
];
