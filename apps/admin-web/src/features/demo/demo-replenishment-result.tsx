import Link from 'next/link';
import type { ReplenishmentResult } from './demo-input';

const patterns: Record<string, string> = {
  smooth: '꾸준한 수요',
  erratic: '변동이 큰 수요',
  intermittent: '간헐적 수요',
  lumpy: '간헐적·변동 수요',
  insufficient: '이력 부족',
  none: '수요 없음',
};
export function DemoReplenishmentResult({
  result,
}: {
  result: ReplenishmentResult;
}) {
  return (
    <section
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"
      aria-label="발주 제안 생성 결과"
    >
      <h2 className="font-semibold">
        실제 상품 {result.items.length}개의 발주 제안 준비 완료
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        최근 {result.historyDays}일의 시연용 합성 수요를 사용했습니다. 실제 판매
        이력이 아닙니다. 아래 수량은 생성 시점의 계산 결과이며, 발주·입고 후에는
        달라집니다.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">상품 / SKU</th>
              <th className="p-2">수요 유형</th>
              <th className="p-2">일평균 수요</th>
              <th className="p-2">현재고 / 미입고</th>
              <th className="p-2">재주문점</th>
              <th className="p-2">발주 제안</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item) => (
              <tr key={item.skuId} className="border-b last:border-0">
                <td className="p-2">
                  <div>{item.skuName}</div>
                  <div className="text-xs text-slate-500">
                    {item.skuCode} · {item.supplierName}
                  </div>
                </td>
                <td className="p-2 whitespace-nowrap">
                  {patterns[item.pattern] ?? item.pattern}
                </td>
                <td className="p-2">{item.dailyMean.toFixed(2)}개</td>
                <td className="p-2 whitespace-nowrap">
                  {item.onHand} / {item.onOrder}개
                </td>
                <td className="p-2">{item.reorderPoint.toFixed(2)}개</td>
                <td className="p-2 font-medium">{item.purchaseQuantity}개</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href="/inventory/replenishment"
        className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
      >
        보충 제안에서 확인하고 발주하기 →
      </Link>
    </section>
  );
}
