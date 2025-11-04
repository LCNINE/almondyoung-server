"use client";

import { BannerCarousel } from './banner-carousel';
import { bannerMockData } from './banner-mock-data';

// 기본 사용법
export function BannerExample() {
  return (
    <div className="space-y-8">
      {/* 기본 배너 */}
      <BannerCarousel slides={bannerMockData} />
      
      {/* 커스텀 높이 배너 */}
      <BannerCarousel 
        slides={bannerMockData} 
        height="300px" 
        autoPlay={false}
      />
      
      {/* aspectRatio 사용 */}
      <BannerCarousel 
        slides={bannerMockData} 
        aspectRatio="16/9"
        autoPlayInterval={5000}
      />
      
      {/* 모바일용 낮은 배너 */}
      <BannerCarousel 
        slides={bannerMockData} 
        height="200px"
        className="md:hidden"
      />
    </div>
  );
}

// 개별 슬라이드 데이터 예시
export const customSlides = [
  {
    id: 'promo-1',
    image: {
      src: 'https://example.com/banner1.jpg',
      alt: '프로모션 배너 1',
      priority: true,
    },
    title: '특별 할인 이벤트',
    subtitle: '지금 바로 확인해보세요',
    href: '/promotion',
    ctaLabel: '자세히 보기',
    className: 'bg-blue-900',
  },
  {
    id: 'promo-2',
    image: {
      src: 'https://example.com/banner2.jpg',
      alt: '프로모션 배너 2',
    },
    title: '신규 회원 혜택',
    subtitle: '첫 구매 시 특별 혜택',
    href: '/signup',
    ctaLabel: '회원가입하기',
  },
];
