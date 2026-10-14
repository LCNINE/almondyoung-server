const ROWS: Array<[string, string]> = [
  ['신청 기한', '제품 받은 날부터 7일 안에 (고객에게는 5일 안에 고객센터로 접수하라고 안내한다)'],
  ['신청 방법', '마이페이지 재작업신청 또는 고객센터. 불량 사진 첨부 권장'],
  ['실물', '전량 반송이 원칙입니다(롯데택배 착불)'],
  ['보상', '업체 잘못이어도 재작업입니다. 환불은 같은 불량이 반복될 때, 배송 사고, 5영업일 이상 지연일 때만'],
  ['불량이 아닌 것', '색 차이 ±10% 미만, RGB 파일, 폰트 미아웃라인, 해상도 미달, 제작 가이드 미준수'],
  ['파일 수정 후 재작업', '제작비 50% 추가'],
  [
    '택배비',
    'FAQ는 "업체 잘못이면 반품 택배비는 업체 부담", 약관은 "추가 운송비는 회사가 부담하지 않음"으로 서로 다릅니다',
  ],
];

export function PrintDefectGuide() {
  return (
    <details className="rounded-md border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-gray-900">
        인쇄 불량·환불 가이드 (와우프레스 재작업 규정)
      </summary>
      <div className="mt-3 space-y-2 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <tbody>
            {ROWS.map(([label, body]) => (
              <tr key={label} className="border-t border-gray-100">
                <th className="w-40 p-2 text-left align-top font-medium whitespace-nowrap text-gray-700">
                  {label}
                </th>
                <td className="p-2 text-gray-800">{body}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500">
          출처: 와우프레스 이용약관 제18조2 재작업 및 환불 규정, 고객센터 FAQ (2026-10-14 조사). API 대리 주문·고객
          직배송 건에도 같은 규정이 적용되는지, 택배비 부담 주체는 와우프레스에 확인이 필요합니다.
        </p>
        <a
          href="https://wowpress.co.kr/archives/info/srvc"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-gray-700 underline"
        >
          와우프레스 이용약관 열기
        </a>
      </div>
    </details>
  );
}
