/** 검수한 물건을 다시 꽂을 대표 선반 — 정해지지 않은 상품도 그렇다고 알린다 */
export function ShelfCode({ code }: { code: string | null }) {
  return (
    <div data-col="shelf" className="text-sm text-[#71717a]">
      선반{' '}
      {code ? <span className="font-mono font-semibold text-[#27272a]">{code}</span> : <span className="text-[#a1a1aa]">미지정</span>}
    </div>
  );
}
