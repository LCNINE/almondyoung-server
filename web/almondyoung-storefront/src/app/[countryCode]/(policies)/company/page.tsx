import { Metadata } from "next"

export const metadata: Metadata = {
  title: "회사소개",
}

export default function CompanyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">회사소개</h1>

      <section className="space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold">주식회사 엘씨나인</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            아몬드영은 주식회사 엘씨나인이 운영하는 B2B 뷰티 도매 플랫폼입니다.
            미용 전문가를 위한 최저가 미용재료 MRO 쇼핑몰로, 다양한 뷰티 제품을
            합리적인 가격에 제공합니다.
          </p>
        </div>

        <div className="border-t pt-6">
          <h2 className="mb-3 text-lg font-semibold">사업자 정보</h2>
          <dl className="text-muted-foreground space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">회사명</dt>
              <dd>주식회사 엘씨나인</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">대표이사</dt>
              <dd>권흥철</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">사업자등록번호</dt>
              <dd>467-86-01638</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">통신판매업신고</dt>
              <dd>2019-서울영등포-1446</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">전화</dt>
              <dd>1877-7184</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">주소</dt>
              <dd>경기도 부천시 평천로832번길 42 (도당동) 4층 엘씨나인</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-foreground w-32 shrink-0 font-medium">개인정보보호책임자</dt>
              <dd>주식회사 엘씨나인 (hello@lcnine.kr)</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  )
}
