/** 검수한 물건을 다시 꽂을 대표 선반 — 정해지지 않은 상품도 그렇다고 알린다 */
export function ShelfCode({ code }: { code: string | null }) {
  return (
    <div data-col="shelf" className="text-sm text-[#3F4450]">
      선반{' '}
      {code ? <span className="font-mono font-semibold text-[#15171C]">{code}</span> : <span className="text-[#6B717D]">미지정</span>}
    </div>
  );
}
