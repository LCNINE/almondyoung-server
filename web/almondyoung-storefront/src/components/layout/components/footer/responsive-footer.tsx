"use client"

import { cn } from "@lib/utils"
import Link from "next/link"
import {
  Phone,
  MessageCircle,
  Instagram,
  Mail,
  MapPin,
  Building2,
  Shield,
  Heart,
  Home,
  Search,
  ShoppingCart,
  User,
  AlignJustify,
} from "lucide-react"
import { usePathname, useParams } from "next/navigation"
import { IconText } from "@components/common/Icon-text"
import { useState, useEffect } from "react"
import { CategoryNavButton, HomeNavButton, MyPageNavButton, SearchNavButton, CartNavButton } from "@components/common/Icon-text/icon-texts"
import { OrderListNavButton } from "@components/common/Icon-text/icon-texts"
import { WishlistNavButton } from "@components/common/Icon-text/icon-texts"
import { FrequentPurchaseNavButton } from "@components/common/Icon-text/icon-texts"
import { CustomInfoNavButton } from "@components/common/Icon-text/icon-texts"

export function ResponsiveFooter({ className }: { className?: string }) {
  const pathname = (usePathname() ?? '/').split('?')[0]
  const params = useParams() as { countryCode?: string }
  const [countryCode, setCountryCode] = useState('kr')
  const [currentRoot, setCurrentRoot] = useState('')
  
  useEffect(() => {
    const segments = pathname.split('/').filter(Boolean)
    const isCountry = (s?: string) => !!s && /^[a-z]{2}$/i.test(s)
    
    // params 우선, 없으면 첫 세그먼트 사용 (없으면 'kr')
    const candidateCC = params?.countryCode ?? segments[0] ?? 'kr'
    const newCountryCode = isCountry(candidateCC) ? candidateCC : 'kr'
    
    // 앞쪽에서 연속으로 나타나는 국가코드들을 모두 스킵
    let i = 0
    while (i < segments.length && isCountry(segments[i])) i++
    
    // 남은 경로 세그먼트 (국가코드 중복 몇 개든 안전)
    const rest = segments.slice(i)
    
    // 하위 경로가 있어도 항상 첫 세그먼트만 비교
    const newCurrentRoot = (rest[0] ?? '').toLowerCase()
    
    setCountryCode(newCountryCode)
    setCurrentRoot(newCurrentRoot)
  }, [pathname, params])

  return (
    <>
      {/* 데스크톱 푸터 */}
      <footer className={cn("hidden bg-stone-200 md:block w-full", className)}>
        <div className="mx-auto max-w-7xl flex-col gap-4 px-4 py-8 text-stone-400 md:flex-row lg:flex">
          {/* 고객센터 정보 */}
          <div className="min-w-[360px]">
            <h3 className="mb-4 text-lg font-semibold">고객센터 1877-7184</h3>
            <div className="flex flex-col gap-2">
              <div className="flex gap-4 text-sm text-stone-400">
                <button className="hover:text-stone-700">전화걸기</button>
                <button className="hover:text-stone-700">
                  카카오챗 채널추가
                </button>
                <button className="hover:text-stone-700">인스타그램</button>
              </div>
              <div className="flex gap-4 text-sm text-stone-400">
                <Link href="/company" className="hover:text-stone-700">
                  회사소개
                </Link>
                <Link href="/terms" className="hover:text-stone-700">
                  이용약관
                </Link>
                <Link
                  href="/privacy"
                  className="font-semibold hover:text-stone-700"
                >
                  개인정보처리방침
                </Link>
                <Link href="/guide" className="hover:text-stone-700">
                  이용안내
                </Link>
              </div>
              <div className="mt-4 text-sm text-stone-400">
                Copyright © 아몬드영. All rights reserved.
              </div>
            </div>
          </div>

          {/* 회사 정보 */}
          <div>
            <div className="mr-10 space-y-1 text-sm text-stone-400">
              <div className="font-semibold">아몬드영 사업자 정보</div>
              <div>회사 : 주식회사 엘씨나인 | 대표자 : 김정희</div>
              <div>사업자 등록번호 : 467-86-01638 [사업자정보확인]</div>
              <div>통신판매업 신고 : 2019-서울영등포-1446</div>
              <div>전화 : 1877-7184</div>
              <div>
                주소 : [14521] 경기도 부천시 평천로832번길 42 (도당동) 4층
                엘씨나인
              </div>
            </div>
          </div>

          {/* 하단 링크 */}
          <div>
            <div className="flex gap-6 text-sm text-stone-400">
              <div className="flex flex-col gap-1">
                <div>교육대상 : 의료인 | 기타교육대상 : 의료인</div>
                <div>의료기관 : 하트웰의원</div>
                <div>
                  의료기관 소재지 : 서울특별시 성동구 아차산로 126 더리브
                  세종타워 201,202호
                </div>
                <div>진료과목 : 피부과,성형외과 등</div>
                <div>대표원장 : 노환규 | 면허번호 : 제 30722 호</div>
                <div>
                  개인정보보호책임자 : 주식회사엘씨나인(hello@lcnine.kr)
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* 모바일 하단 네비게이션 바 */}
      <div
        className={cn(
          "w-full bg-background fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] md:hidden",
          className
        )}
      >
          <div className="grid grid-cols-5 justify-between items-center w-full">
           <HomeNavButton isActive={currentRoot === '' || currentRoot === 'home'} />
           <CategoryNavButton isActive={currentRoot === 'category'} />
           <CartNavButton isActive={currentRoot === 'cart'} />
           <SearchNavButton isActive={currentRoot === 'search'} />
           <MyPageNavButton isActive={currentRoot === 'mypage'} />
          </div>
      </div>

      {/* 모바일 푸터 정보 */}
      <div className="bg-gray-40 pt-6 pb-20 md:hidden">
        <div className="px-4">
          {/* 고객센터 */}
          <div className="mb-4 text-center">
            <h3 className="mb-2 text-base font-semibold text-gray-10">
              고객센터 1877-7184
            </h3>
            <div className="flex justify-center gap-3 text-sm text-gray-10">
              <button className="hover:text-gray-10">전화걸기</button>
              <button className="hover:text-gray-10">카카오챗</button>
              <button className="hover:text-gray-10">인스타그램</button>
            </div>
          </div>

          {/* 회사 정보 (간소화) */}
          <div className="space-y-1 text-center text-xs text-gray-10">
            <div>주식회사 엘씨나인 | 대표자: 김정희</div>
            <div>사업자등록번호: 467-86-01638</div>
            <div>통신판매업신고: 2019-서울영등포-1446</div>
            <div>전화: 1877-7184</div>
            <div>경기도 부천시 평천로832번길 42 (도당동) 4층</div>
          </div>

          {/* 하단 링크 */}
          <div className="mt-4 border-t pt-3">
            <div className="flex justify-center gap-4 text-xs text-gray-800">
              <Link href="/company" className="hover:text-gray-700">
                회사소개
              </Link>
              <Link href="/terms" className="hover:text-gray-700">
                이용약관
              </Link>
              <Link
                href="/privacy"
                className="font-semibold hover:text-gray-700"
              >
                개인정보처리방침
              </Link>
              <Link href="/guide" className="hover:text-gray-700">
                이용안내
              </Link>
            </div>
            <div className="mt-2 text-center text-xs text-gray-800">
              Copyright © 아몬드영. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
