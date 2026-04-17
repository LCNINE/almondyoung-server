import Link from "next/link"
import { cn } from "@lib/utils"
import { Button } from "@/components/ui/button"
import { FooterInfoLine } from "./footer-info-line"

export default function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn("w-full", className)}>
      {/* --- 데스크탑 뷰 --- */}
      <div className="hidden w-full bg-stone-200 md:block">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 text-stone-400 md:flex-row lg:gap-12">
          <section className="flex-1 md:max-w-sm">
            <h3 className="mb-4 text-lg font-bold text-stone-500">
              고객센터 1877-7184
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link href="tel:18777184" target="_blank">
                    전화걸기
                  </Link>
                </Button>
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link href="https://pf.kakao.com/_xaxgxazs" target="_blank">
                    카카오챗 채널추가
                  </Link>
                </Button>
                <Button
                  variant="link"
                  asChild
                  className="px-0 py-0 text-stone-400 hover:text-stone-700 hover:underline"
                >
                  <Link
                    href="https://www.instagram.com/almondyoung_official/"
                    target="_blank"
                  >
                    인스타그램
                  </Link>
                </Button>
              </div>
              <nav className="flex flex-wrap gap-4 text-sm">
                <Link
                  href="/kr/company"
                  className="hover:text-stone-700 hover:underline"
                >
                  회사소개
                </Link>
                <Link
                  href="/kr/terms"
                  className="hover:text-stone-700 hover:underline"
                >
                  이용약관
                </Link>
                <Link
                  href="/kr/privacy"
                  className="font-bold text-stone-600 hover:text-stone-800 hover:underline"
                >
                  개인정보처리방침
                </Link>
                <Link
                  href="/kr/guide"
                  className="hover:text-stone-700 hover:underline"
                >
                  이용안내
                </Link>
              </nav>
              <p className="mt-4 text-sm">
                Copyright © 아몬드영. All rights reserved.
              </p>
            </div>
          </section>
          <address className="flex-1 space-y-1 not-italic">
            <strong className="mb-2 block font-semibold text-stone-500">
              아몬드영 사업자 정보
            </strong>
            <FooterInfoLine>
              회사 : 주식회사 엘씨나인 | 대표이사 : 권흥철
            </FooterInfoLine>
            <FooterInfoLine>
              사업자 등록번호 : 467-86-01638 [사업자정보확인]
            </FooterInfoLine>
            <FooterInfoLine>
              통신판매업 신고 : 2019-서울영등포-1446
            </FooterInfoLine>
            <FooterInfoLine>전화 : 1877-7184</FooterInfoLine>
            <FooterInfoLine>
              주소 : [14521] 경기도 부천시 평천로832번길 42 (도당동) 4층
              엘씨나인
            </FooterInfoLine>
          </address>
          <div className="flex-1 space-y-1">
            <FooterInfoLine>
              교육대상 : 의료인 | 기타교육대상 : 의료인
            </FooterInfoLine>
            <FooterInfoLine>의료기관 : 하트웰의원</FooterInfoLine>
            <FooterInfoLine>
              의료기관 소재지 : 서울특별시 성동구 아차산로 126 더리브 세종타워
              201,202호
            </FooterInfoLine>
            <FooterInfoLine>진료과목 : 피부과,성형외과 등</FooterInfoLine>
            <FooterInfoLine>
              대표원장 : 노환규 | 면허번호 : 제 30722 호
            </FooterInfoLine>
            <FooterInfoLine>
              개인정보보호책임자 : 주식회사엘씨나인(hello@lcnine.kr)
            </FooterInfoLine>
          </div>
        </div>
      </div>

      {/* --- 모바일 뷰 --- */}
      <div className="block md:hidden">
        <div className="border-t border-stone-100 bg-stone-50 px-5 pt-10 pb-28">
          <div className="text-left">
            {/* 고객센터 */}
            <section className="mb-8">
              <h3 className="mb-3 text-[15px] font-bold text-stone-800">
                고객센터 1877-7184
              </h3>
              <div className="flex justify-start gap-4 text-sm font-medium text-stone-600">
                <button type="button" className="hover:text-stone-900">
                  전화걸기
                </button>
                <div className="h-3 w-px self-center bg-stone-300" />
                <button type="button" className="hover:text-stone-900">
                  카카오챗
                </button>
                <div className="h-3 w-px self-center bg-stone-300" />
                <button type="button" className="hover:text-stone-900">
                  인스타그램
                </button>
              </div>
            </section>

            {/* 정책 링크 */}
            <nav className="mb-6 flex flex-wrap justify-start gap-x-4 gap-y-2 text-xs text-stone-500">
              <Link href="/kr/company" className="hover:text-stone-800">
                회사소개
              </Link>
              <Link href="/kr/terms" className="hover:text-stone-800">
                이용약관
              </Link>
              <Link
                href="/kr/privacy"
                className="font-bold text-stone-700 hover:text-stone-900"
              >
                개인정보처리방침
              </Link>
              <Link href="/kr/guide" className="hover:text-stone-800">
                이용안내
              </Link>
            </nav>

            {/* 회사 정보 */}
            <address className="space-y-1 text-[11px] leading-relaxed text-stone-400 not-italic">
              <p>주식회사 엘씨나인 | 대표이사: 권흥철</p>
              <p>사업자등록번호: 467-86-01638</p>
              <p>통신판매업신고: 2019-서울영등포-1446</p>
              <p>전화: 1877-7184</p>
              <p>경기도 부천시 평천로832번길 42 (도당동) 4층</p>
            </address>

            <div className="mt-6 border-t border-stone-200 pt-4">
              <p className="text-[10px] text-stone-300">
                Copyright © 아몬드영. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
