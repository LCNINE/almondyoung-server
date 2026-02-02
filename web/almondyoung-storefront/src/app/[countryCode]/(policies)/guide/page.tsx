import { Metadata } from "next"

export const metadata: Metadata = {
  title: "이용안내",
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-2xl font-bold">이용안내</h1>

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">주문 및 결제</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>원하시는 상품을 장바구니에 담은 후 결제를 진행해주세요.</li>
            <li>결제 수단: 신용카드, 계좌이체, 가상계좌, 간편결제</li>
            <li>주문 후 결제가 확인되면 배송이 시작됩니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">배송 안내</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>배송비: 상품별 상이 (상품 페이지에서 확인)</li>
            <li>배송 기간: 결제 완료 후 영업일 기준 1~3일</li>
            <li>배송 조회: 마이페이지에서 실시간 배송 추적 가능</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">교환 및 반품</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>상품 수령 후 7일 이내 교환/반품 신청 가능</li>
            <li>상품 하자 시 배송비는 회사 부담</li>
            <li>단순 변심 시 배송비는 고객 부담</li>
            <li>사용하거나 훼손된 상품은 교환/반품이 불가합니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">고객센터</h2>
          <ul className="text-muted-foreground list-inside list-disc space-y-1.5 text-sm leading-relaxed">
            <li>전화: 1877-7184</li>
            <li>카카오톡 채널: 아몬드영</li>
            <li>이메일: hello@lcnine.kr</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
