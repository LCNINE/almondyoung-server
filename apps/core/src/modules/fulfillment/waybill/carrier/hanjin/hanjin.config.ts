export interface HanjinConfig {
  clientId: string;
  apiKey: string;
  secretKey: string;
  contractNo: string;
  orderBaseUrl: string;
  printBaseUrl: string;
  timeoutMs: number;
  sender: { name: string; zip: string; baseAddress: string; detailAddress: string; tel: string };
  boxType: string;
  payType: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

// insert-order 의 허용값 집합(정본 §4.2 의 24·25번). 밖의 값을 보내면 한진이
// ERROR-10(지불조건) / ERROR-11(박스타입) 으로 거절한다.
const BOX_TYPE_CODES: ReadonlySet<string> = new Set(['S', 'A', 'B', 'C', 'D', 'E']);
const PAY_TYPE_CODES: ReadonlySet<string> = new Set(['CD', 'CT', 'PP', 'CC']);

export function loadHanjinConfig(env: NodeJS.ProcessEnv = process.env): HanjinConfig {
  const timeout = Number(env.HANJIN_TIMEOUT_MS);
  return {
    clientId: env.HANJIN_CLIENT_ID ?? '',
    apiKey: env.HANJIN_API_KEY ?? '',
    secretKey: env.HANJIN_SECRET_KEY ?? '',
    contractNo: env.HANJIN_CONTRACT_NO ?? '',
    orderBaseUrl: env.HANJIN_ORDER_BASE_URL ?? '',
    printBaseUrl: env.HANJIN_PRINT_BASE_URL ?? '',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    sender: {
      name: env.HANJIN_SENDER_NAME ?? '',
      zip: env.HANJIN_SENDER_ZIP ?? '',
      baseAddress: env.HANJIN_SENDER_BASE_ADDR ?? '',
      detailAddress: env.HANJIN_SENDER_DTL_ADDR ?? '',
      tel: env.HANJIN_SENDER_TEL ?? '',
    },
    boxType: env.HANJIN_BOX_TYPE ?? 'A',
    payType: env.HANJIN_PAY_TYPE ?? 'PP',
  };
}

const filled = (v: string | undefined): boolean => !!v && !!v.trim();

/**
 * 설정이 못 채운 env 키 이름을 순서대로 돌려준다. 비어 있으면 발행 준비가 끝난 것이다.
 *
 * insert-order(정본 §4.2)가 필수로 요구하는 것을 «전부» 본다 — 인증·계약·URL 뿐 아니라
 * 송하인 5필드(`sndrZip`·`sndrBaseAddr`·`sndrDtlAddr`·`sndrNm`·`sndrTelNo`)와 박스/지불 코드까지.
 *
 * 이 게이트를 좁게 두면 미설정이 «복구 가능한 구성 오류»(409 `WAYBILL_CARRIER_NOT_CONFIGURED`)가
 * 아니라 한진의 `ERROR-01` → `definitive_rejection` → waybill `failed`(종료상태)로 기록된다.
 */
export function missingHanjinConfig(c: HanjinConfig): string[] {
  const required: Array<[string, boolean]> = [
    ['HANJIN_CLIENT_ID', filled(c.clientId)],
    ['HANJIN_API_KEY', filled(c.apiKey)],
    ['HANJIN_SECRET_KEY', filled(c.secretKey)],
    ['HANJIN_CONTRACT_NO', filled(c.contractNo)],
    ['HANJIN_ORDER_BASE_URL', filled(c.orderBaseUrl)],
    ['HANJIN_PRINT_BASE_URL', filled(c.printBaseUrl)],
    ['HANJIN_SENDER_NAME', filled(c.sender.name)],
    ['HANJIN_SENDER_ZIP', filled(c.sender.zip)],
    ['HANJIN_SENDER_BASE_ADDR', filled(c.sender.baseAddress)],
    ['HANJIN_SENDER_DTL_ADDR', filled(c.sender.detailAddress)],
    ['HANJIN_SENDER_TEL', filled(c.sender.tel)],
    ['HANJIN_BOX_TYPE', BOX_TYPE_CODES.has(c.boxType)],
    ['HANJIN_PAY_TYPE', PAY_TYPE_CODES.has(c.payType)],
  ];
  return required.filter(([, ok]) => !ok).map(([key]) => key);
}

export function isHanjinConfigured(c: HanjinConfig): boolean {
  return missingHanjinConfig(c).length === 0;
}
