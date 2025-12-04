"use client"
import React from "react"
import { ChevronUp } from "lucide-react"

import { RankProductCard } from "@components/products/product-card"

import RankedKeywordList, {
  type Keyword,
} from "domains/best/components/ranked-keyword-list"
import RankedHeader from "domains/best/components/ranked-header"

export default function BestPage() {
  const keywords: Keyword[] = [
    {
      rank: 1,
      name: "롤리킹",
      category: "속눈썹",
      trend: "stable",
      products: [
        {
          id: "1",
          name: "롤리킹 펌제 1제 2제",
          thumbnail:
            "https://almondyoung.com/web/product/medium/202503/886c090e18bc4250906bb6547fc1e288.png",
          basePrice: 50700,
          membershipPrice: 45700,
          isMembershipOnly: true,
          status: "active",
          optionMeta: {
            isSingle: true,
          },
          rating: 4.5,
          reviewCount: 128,
          defaultSku: 1,
          stock: {
            available: 10,
          },
        },
        {
          id: "2",
          name: "롤리킹 에센스 5ml",
          thumbnail:
            "https://almondyoung.com/web/product/medium/202102/1f4acb324f0bb16ab17a3fce5b1de977.jpg",
          basePrice: 50700,
          membershipPrice: 45700,
          isMembershipOnly: false,
          status: "active",
          optionMeta: {
            isSingle: true,
          },
          rating: 4.5,
          reviewCount: 128,
          defaultSku: 2,
          stock: {
            available: 5,
          },
        },
        {
          id: "3",
          name: "롤리킹 글루",
          thumbnail:
            "https://almondyoung.com/web/product/medium/202506/578c8abce2ae44fc6dd672ad65a66a20.png",
          basePrice: 39900,
          membershipPrice: 29900,
          isMembershipOnly: false,
          status: "active",
          optionMeta: {
            isSingle: true,
          },
          rating: 4.5,
          reviewCount: 128,
          defaultSku: 3,
          stock: {
            available: 15,
          },
        },
        {
          id: "4",
          name: "롤리킹 롯드",
          thumbnail:
            "https://almondyoung.com/web/product/medium/202211/9e65f27af1d04eb9606eaf65dbf1d404.jpg",
          basePrice: 50700,
          membershipPrice: 45700,
          isMembershipOnly: false,
          status: "active",
          optionMeta: {
            isSingle: true,
          },
          rating: 4.5,
          reviewCount: 128,
          defaultSku: 4,
          stock: {
            available: 8,
          },
        },
      ],
    },
    {
      rank: 2,
      name: "뽀로로서프라이즈백",
      category: "완구/인형",
      trend: "stable",
    },
    { rank: 3, name: "행잉자스민", category: "원예/식물", trend: "up" },
    {
      rank: 4,
      name: "초코송이말차",
      category: "과자/베이커리",
      trend: "stable",
    },
    {
      rank: 5,
      name: "라뮤즈마스크팩",
      category: "마스크/팩",
      trend: "up",
    },
    {
      rank: 6,
      name: "에어팟프로2세대",
      category: "이어폰/헤드폰",
      trend: "down",
    },
    {
      rank: 7,
      name: "크리스마스트리",
      category: "인테리어",
      trend: "up",
    },
    {
      rank: 8,
      name: "롱패딩",
      category: "여성의류",
      trend: "up",
    },
    {
      rank: 9,
      name: "전기히터",
      category: "가전제품",
      trend: "up",
    },
    {
      rank: 10,
      name: "겨울부츠",
      category: "신발",
      trend: "stable",
    },
  ]

  const liveItems = [
    {
      id: "11",
      rank: 1,
      name: "[일룸] 쿠시노 코지 범퍼형 저상형침대(SS) 올인원 패키지 / 패밀리침대 키즈침대",
      thumbnail: "/api/placeholder/240/240",
      basePrice: 1919000,
      membershipPrice: 1727000,
      isMembershipOnly: false,
      status: "active",
      optionMeta: {
        isSingle: true,
      },
      rating: 4.5,
      reviewCount: 128,
      defaultSku: 11,
      stock: {
        available: 3,
      },
    },
    {
      id: "12",
      rank: 2,
      name: "에코백스 X11 OMNICYCLONE 아쿠아 롤러형 올인원 로봇 청소기",
      thumbnail: "/api/placeholder/240/240",
      basePrice: 1690000,
      membershipPrice: 1521000,
      isMembershipOnly: false,
      status: "active",
      optionMeta: {
        isSingle: true,
      },
      rating: 4.5,
      reviewCount: 128,
      defaultSku: 12,
      stock: {
        available: 5,
      },
    },
    {
      id: "13",
      rank: 3,
      name: "보국 전기요 탄소매트 카본 전기매트 온열 전기장판 버니글로우",
      thumbnail: "/api/placeholder/240/240",
      basePrice: 269000,
      membershipPrice: 149000,
      isMembershipOnly: false,
      status: "active",
      optionMeta: {
        isSingle: true,
      },
      rating: 4.5,
      reviewCount: 128,
      defaultSku: 13,
      stock: {
        available: 12,
      },
    },
    {
      id: "14",
      rank: 4,
      name: "삼성전자 갤럭시탭 S10 FE 플러스 SM-X620 그레이 128GB WiFi 전용",
      thumbnail: "/api/placeholder/240/240",
      basePrice: 869000,
      membershipPrice: 733000,
      isMembershipOnly: false,
      status: "active",
      optionMeta: {
        isSingle: true,
      },
      rating: 4.5,
      reviewCount: 128,
      defaultSku: 14,
      stock: {
        available: 7,
      },
    },
    {
      id: "15",
      rank: 5,
      name: "[라이브 혜택가 45만] 삼성전자 갤럭시탭 S10 FE WiFi 전용 128GB 그레이",
      thumbnail: "/api/placeholder/240/240",
      basePrice: 698500,
      membershipPrice: 585870,
      isMembershipOnly: false,
      status: "active",
      optionMeta: {
        isSingle: true,
      },
      rating: 4.5,
      reviewCount: 128,
      defaultSku: 15,
      stock: {
        available: 4,
      },
    },
  ]

  return (
    <div className="min-h-screen">
      {/* Main Content */}
      <main className="container mx-auto max-w-[1100px] px-4 py-6 md:px-[40px]">
        {/* 많이본 best */}
        <section className="rounded-lg border-t border-gray-200 bg-white py-8">
          <RankedHeader title="BEST ITEMS" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {liveItems.map((item) => (
              <RankProductCard
                key={item.id}
                product={item}
                rank={item.rank}
              />
            ))}
          </div>
        </section>

        <section className="my-8 rounded-lg bg-white">
          <RankedHeader title="BEST BRAND" />
          <RankedKeywordList keywords={keywords} />
        </section>

        {/* Best Keyword Section */}
        <section className="my-8 rounded-lg bg-white">
          <RankedHeader title="BEST KEYWORD" />
          <RankedKeywordList keywords={keywords} />
        </section>
      </main>

      {/* Scroll to Top Button */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed right-8 bottom-8 rounded-full border bg-white p-3 shadow-lg hover:bg-gray-50"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
    </div>
  )
}
