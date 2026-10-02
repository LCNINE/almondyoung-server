import type { HanjinConfig } from '../hanjin.config';
import type { IssueContext, WaybillRow } from '../../../waybill.types';
import { commodityNameOf, composeMessage, parseRecipient } from '../../../waybill-request.assembler';
import type { LabelItem } from '../../../label/label-items';

/** print-wbl 분류필드(정본 §3.2). labelData 에 없으면 '' — demo 캐리어는 일부만 채운다. */
export interface HanjinSortFields {
  hubCode: string; // ① hub_cod
  terminalCode: string; // ② tml_cod (③ CODE128 데이터)
  terminalName: string; // tml_nam — NL 샘플 ② 아래 「중구」(필드표 번호 없음, #920 에서 확인)
  midCode: string; // ④ dom_mid
  centerCode: string; // ⑤ cen_cod
  centerName: string; // ⑥ cen_nam
  originTerminalCode: string; // ⑦ s_tml_cod
  originTerminalName: string; // ⑧ s_tml_nam
  routeRank: string; // ⑩ grp_rnk
  courierName: string; // ⑪ es_nam
  courierSortCode: string; // ⑯ es_cod
  addressSummary: string; // ⑫ prt_add
}

/** 종이에 그려지는 «내용» — 지문의 입력이다. 출력할 때마다 달라지는 값은 여기 넣지 않는다(스펙 §10.2). */
export interface HanjinLabelContent {
  trackingNo: string;
  trackingNoDisplay: string;
  sort: HanjinSortFields;
  regionText: string; // ⑮
  freightText: string; // ⑬
  recipient: { name: string; phone: string; baseAddress: string; detailAddress: string };
  sender: { name: string; phone: string; baseAddress: string };
  deliveryMessage: string; // ⑭ — 공동현관 비밀번호 포함. 바뀌면 종이가 달라지므로 지문도 바뀐다
  commodityName: string; // 한진 등록 품명과 같은 값 — NS·NL 이 찍는다
  items: LabelItem[]; // (로케이션, SKU) 배정 행 — FS 가 찍는다
  boxType: string; // 운임Type
  custOrdNo: string; // 출고번호
  boxIndex: number; // shipment 하나 = 박스 하나
  boxCount: number;
}

/** 출력 시점 값 — 지문 밖. */
export interface HanjinLabelPrintValues {
  printedDate: string; // YYYY-MM-DD, Asia/Seoul
  /** 판차. 1 이면 종이에 찍지 않는다(스펙 §10.1-4). */
  revision: number;
}

/** 템플릿이 그리는 값 전부 — **마스킹 전 원본**이다. 어느 면에 무엇을 가리는지는 면을 아는 템플릿이 정한다. */
export type HanjinLabelData = HanjinLabelContent & HanjinLabelPrintValues;

export interface BuildHanjinLabelContentInput {
  waybill: Pick<WaybillRow, 'trackingNo' | 'custOrdNo' | 'labelData'>;
  ctx: IssueContext;
  config: HanjinConfig;
  items: readonly LabelItem[];
}

// ⑮ dom_rgn (정본 §3.2): 1 수도권 / 2~6 지방 / 7 제주 / 9 도서.
const REGION_TEXT: Readonly<Record<string, string>> = {
  '1': '수도권',
  '2': '지방',
  '3': '지방',
  '4': '지방',
  '5': '지방',
  '6': '지방',
  '7': '제주',
  '9': '도서',
};

// ⑬ 운임지급 기준. 선·착불(PP/CC)은 운송료 금액을 반드시 찍어야 하는데 우리에게 출처가 없다(스펙 §4.2).
// CD 는 「발지신용」(발송지 쪽 신용 — CT 착지신용의 짝). 포털 FS 샘플 표기와 같다. 정본 §4.2 의 옛 「받지신용」은 오기였다.
const FREIGHT_TEXT: Readonly<Record<string, string>> = { CD: '발지신용' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function buildHanjinLabelContent({
  waybill,
  ctx,
  config,
  items,
}: BuildHanjinLabelContentInput): HanjinLabelContent {
  const freightText = FREIGHT_TEXT[config.payType];
  if (!freightText) {
    throw new Error(
      `Hanjin label: payType ${config.payType} requires a freight amount on the label, which is unsupported (only CD)`,
    );
  }
  const { trackingNo, custOrdNo } = waybill;
  if (!trackingNo || !custOrdNo) throw new Error('Hanjin label: waybill has no trackingNo or custOrdNo');

  const raw = isRecord(waybill.labelData) ? waybill.labelData : {};
  const field = (key: string): string => {
    const v = raw[key];
    return typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  };
  const rc = parseRecipient(ctx.recipientSnapshot);
  const regionCode = field('dom_rgn');

  return {
    trackingNo,
    trackingNoDisplay: /^\d{12}$/.test(trackingNo)
      ? trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')
      : trackingNo,
    sort: {
      hubCode: field('hub_cod'),
      terminalCode: field('tml_cod'),
      terminalName: field('tml_nam'),
      midCode: field('dom_mid'),
      centerCode: field('cen_cod'),
      centerName: field('cen_nam'),
      originTerminalCode: field('s_tml_cod'),
      originTerminalName: field('s_tml_nam'),
      routeRank: field('grp_rnk'),
      courierName: field('es_nam'),
      courierSortCode: field('es_cod'),
      addressSummary: field('prt_add'),
    },
    regionText: REGION_TEXT[regionCode] ?? regionCode,
    freightText,
    recipient: {
      name: rc.recipientName,
      phone: rc.phone,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
    },
    sender: { name: config.sender.name, phone: config.sender.tel, baseAddress: config.sender.baseAddress },
    deliveryMessage: composeMessage(rc.deliveryNote, ctx.entrancePassword) ?? '',
    commodityName: commodityNameOf(ctx.lines),
    items: [...items],
    boxType: config.boxType,
    custOrdNo,
    boxIndex: 1,
    boxCount: 1,
  };
}

export function buildHanjinLabelData(input: {
  content: HanjinLabelContent;
  now: Date;
  revision: number;
}): HanjinLabelData {
  return { ...input.content, printedDate: kstDate(input.now), revision: input.revision };
}
