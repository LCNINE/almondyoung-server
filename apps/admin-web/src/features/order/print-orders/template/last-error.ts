// core 는 이 영어 문구를 접두어로 판정에 쓰므로 바꾸지 않고, 보드에서만 한글로 옮긴다
const REASONS: [prefix: string, korean: string][] = [
  [
    'order sent but response lost',
    '와우프레스에 주문을 보냈지만 응답을 못 받았습니다. 5분 뒤 주문 키로 와우프레스에 주문이 들어갔는지 조회합니다.',
  ],
  [
    'order sent but not confirmed',
    '와우프레스에 주문을 보냈지만 들어갔는지 확인하지 못했습니다. 와우프레스에서 주문을 확인한 뒤 재전송해 주세요.',
  ],
  [
    'order sent, ordnum ',
    '와우프레스 주문번호를 받았지만 저장하지 못했습니다. 와우프레스에서 주문을 확인해 주세요.',
  ],
  [
    'duplicate wowpress order suspected',
    '와우프레스에 같은 주문이 두 번 들어갔을 수 있습니다. 와우프레스에서 확인해 주세요.',
  ],
  [
    'order placed after cancel',
    '취소한 뒤에 와우프레스 주문이 들어왔습니다. 와우프레스에서 확인해 주세요.',
  ],
  [
    'almond design does not belong to the ordering customer',
    '주문한 고객의 시안이 아니라서 발주하지 않았습니다.',
  ],
  [
    'almond design does not match the purchased print product or size',
    '시안이 구매한 인쇄 상품이나 크기와 달라서 발주하지 않았습니다.',
  ],
  [
    'no wowpress spec for variant',
    '와우프레스 품목 매핑이 없는 옵션이라 발주하지 않았습니다.',
  ],
  [
    'channel decreased quantity before the print was ordered',
    '발주 전에 주문 수량이 줄었습니다. 수량을 확인한 뒤 진행해 주세요.',
  ],
  [
    'sales order cancelled after print shipped',
    '인쇄물이 출고된 뒤 주문이 취소됐습니다. 반품·환불을 확인해 주세요.',
  ],
  [
    'print order cancelled but sales cancel failed',
    '와우프레스 발주는 취소했지만 판매 주문 취소에 실패했습니다.',
  ],
  [
    'wowpress cancelled but sales cancel failed',
    '와우프레스 주문은 취소했지만 판매 주문 취소에 실패했습니다.',
  ],
  [
    'cancelled on channel while submitting',
    '발주하는 사이에 주문이 취소됐습니다.',
  ],
];

const REJECTED = 'wowpress rejected the order: ';
export const VENDOR_CANCELLED = 'wowpress needs attention: cancelled';
const JOB_ERROR = 'wowpress needs attention: job error ';

// 와우프레스 API 문서의 주문작업상태코드(JobStat) 중 에러
const JOB_ERRORS: Record<string, string> = {
  '109': '에러처리',
  '121': '파일에러-그룹에러',
  '122': '파일에러-테두리선에러',
  '123': '파일에러-폰트아웃라인에러',
  '124': '파일에러-프로그램버전에러',
  '125': '파일에러-칼선없음',
  '126': '파일에러-데이타누락',
  '127': '파일에러-사이즈에러',
  '128': '접수에러-건수불일치',
  '129': '접수에러-양단면접수에러',
  '130': '파일에러-이미지유실',
  '131': '파일에러-기타',
};

// 여러 기록이 ' | ' 로 이어 붙을 수 있다. 모르는 문구는 원문 그대로 둔다
export function describeLastError(raw: string): string[] {
  return raw.split(' | ').map((part) => {
    if (part.startsWith(REJECTED))
      return `와우프레스가 주문을 받지 않았습니다. 사유: ${part.slice(REJECTED.length)}`;
    if (part === VENDOR_CANCELLED)
      return '와우프레스에서 주문이 취소됐습니다. 취소 완료함을 눌러 고객 주문을 취소하고 환불해 주세요.';
    if (part.startsWith(JOB_ERROR)) {
      const code = part.slice(JOB_ERROR.length);

      return `와우프레스 접수 에러: ${JOB_ERRORS[code] ?? code}. 와우프레스 주문배송조회에서 파일재접수나 주문취소로 처리해 주세요.`;
    }
    const found = REASONS.find(([prefix]) => part.startsWith(prefix));

    return found ? found[1] : part;
  });
}
