import type { HanjinConfig } from '../hanjin.config';
import type { IssueContext, WaybillRow } from '../../../waybill.types';
import { commodityNameOf, composeMessage, parseRecipient } from '../../../waybill-request.assembler';

/** print-wbl 분류필드(정본 §3.2). labelData 에 없으면 '' — demo 캐리어는 일부만 채운다. */
export interface HanjinSortFields {
  hubCode: string; // ① hub_cod
  terminalCode: string; // ② tml_cod (③ CODE128 데이터)
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

/**
 * 템플릿이 그리는 값 전부 — **마스킹 전 원본**이다. 어느 면에 무엇을 가리는지는 면을 아는 템플릿이 정한다.
 */
export interface HanjinLabelData {
  trackingNo: string;
  trackingNoDisplay: string;
  sort: HanjinSortFields;
  regionText: string; // ⑮
  freightText: string; // ⑬
  recipient: { name: string; phone: string; baseAddress: string; detailAddress: string };
  sender: { name: string; phone: string; baseAddress: string };
  deliveryMessage: string; // ⑭
  commodityName: string;
  boxType: string; // 운임Type
  custOrdNo: string; // 출고번호
  printedDate: string; // YYYY-MM-DD, Asia/Seoul
  boxIndex: number; // shipment 하나 = 박스 하나
  boxCount: number;
}

export interface BuildHanjinLabelInput {
  waybill: Pick<WaybillRow, 'trackingNo' | 'custOrdNo' | 'labelData'>;
  ctx: IssueContext;
  config: HanjinConfig;
  now: Date;
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
// CD 의 명칭은 포털 FS 샘플 표기를 따른다(정본 §4.2 는 「받지신용」 — 스펙 §12 열린 질문).
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

export function buildHanjinLabelData({ waybill, ctx, config, now }: BuildHanjinLabelInput): HanjinLabelData {
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
    boxType: config.boxType,
    custOrdNo,
    printedDate: kstDate(now),
    boxIndex: 1,
    boxCount: 1,
  };
}
