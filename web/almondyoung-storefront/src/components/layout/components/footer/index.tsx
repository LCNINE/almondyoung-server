// components/layout/footer.tsx
import Link from "next/link"
import { cn } from "@lib/utils"

export default function Footer({ className }: { className?: string }) {
  return (
    <footer className={cn("w-full", className)}>
      {/* --- 데스크탑 뷰 (변경 없음) --- */}
      <div className="hidden w-full bg-stone-200 md:block">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 text-stone-400 md:flex-row lg:gap-12">
          {/* ... 데스크탑 내용 동일 ... */}
          <section className="flex-1 md:max-w-sm">
            <h3 className="mb-4 text-lg font-bold text-stone-500">
              고객센터 1877-7184
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                <button
                  type="button"
                  className="hover:text-stone-700 hover:underline"
                >
                  전화걸기
                </button>
                <button
                  type="button"
                  className="hover:text-stone-700 hover:underline"
                >
                  카카오챗 채널추가
                </button>
                <button
                  type="button"
                  className="hover:text-stone-700 hover:underline"
                >
                  인스타그램
                </button>
              </div>
              <nav className="flex gap-4 text-sm">
                <Link
                  href="/company"
                  className="hover:text-stone-700 hover:underline"
                >
                  회사소개
                </Link>
                <Link
                  href="/terms"
                  className="hover:text-stone-700 hover:underline"
                >
                  이용약관
                </Link>
                <Link
                  href="/privacy"
                  className="font-bold text-stone-600 hover:text-stone-800 hover:underline"
                >
                  개인정보처리방침
                </Link>
                <Link
                  href="/guide"
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
          <address className="flex-1 space-y-1 text-sm not-italic">
            <strong className="mb-2 block font-semibold text-stone-500">
              아몬드영 사업자 정보
            </strong>
            <p>회사 : 주식회사 엘씨나인 | 대표자 : 김정희</p>
            <p>사업자 등록번호 : 467-86-01638 [사업자정보확인]</p>
            <p>통신판매업 신고 : 2019-서울영등포-1446</p>
            <p>전화 : 1877-7184</p>
            <p>
              주소 : [14521] 경기도 부천시 평천로832번길 42 (도당동) 4층
              엘씨나인
            </p>
          </address>
          <div className="flex-1 space-y-1 text-sm">
            <p>교육대상 : 의료인 | 기타교육대상 : 의료인</p>
            <p>의료기관 : 하트웰의원</p>
            <p>
              의료기관 소재지 : 서울특별시 성동구 아차산로 126 더리브 세종타워
              201,202호
            </p>
            <p>진료과목 : 피부과,성형외과 등</p>
            <p>대표원장 : 노환규 | 면허번호 : 제 30722 호</p>
            <p>개인정보보호책임자 : 주식회사엘씨나인(hello@lcnine.kr)</p>
          </div>
        </div>
      </div>

      {/* --- 모바일 뷰 (수정됨: 왼쪽 정렬) --- */}
      <div className="block md:hidden">
        <div className="border-t border-stone-100 bg-stone-50 px-5 pt-10 pb-28">
          {/* [수정] text-center 제거 -> text-left (기본값) 적용 */}
          <div className="text-left">
            {/* 고객센터 */}
            <section className="mb-8">
              <h3 className="mb-3 text-[15px] font-bold text-stone-800">
                고객센터 1877-7184
              </h3>
              {/* [수정] justify-center -> justify-start (왼쪽 정렬) */}
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
            {/* [수정] justify-center -> justify-start (왼쪽 정렬) 
                flex-wrap을 추가하여 화면이 좁을 때 줄바꿈이 자연스럽게 되도록 함 */}
            <nav className="mb-6 flex flex-wrap justify-start gap-x-4 gap-y-2 text-xs text-stone-500">
              <Link href="/company" className="hover:text-stone-800">
                회사소개
              </Link>
              <Link href="/terms" className="hover:text-stone-800">
                이용약관
              </Link>
              <Link
                href="/privacy"
                className="font-bold text-stone-700 hover:text-stone-900"
              >
                개인정보처리방침
              </Link>
              <Link href="/guide" className="hover:text-stone-800">
                이용안내
              </Link>
            </nav>

            {/* 회사 정보 */}
            {/* 부모 div가 text-left이므로 자연스럽게 왼쪽 정렬됩니다 */}
            <address className="space-y-1 text-[11px] leading-relaxed text-stone-400 not-italic">
              <p>주식회사 엘씨나인 | 대표자: 김정희</p>
              <p>사업자등록번호: 467-86-01638</p>
              <p>통신판매업신고: 2019-서울영등포-1446</p>
              <p>전화: 1877-7184</p>
              <p>경기도 부천시 평천로832번길 42 (도당동) 4층</p>
            </address>

            <div className="mt-6 border-t border-stone-200 pt-4">
              {/* [수정] text-center 제거 */}
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
