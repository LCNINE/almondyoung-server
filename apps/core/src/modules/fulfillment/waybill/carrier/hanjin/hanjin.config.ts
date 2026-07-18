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

export function isHanjinConfigured(c: HanjinConfig): boolean {
  return !!(c.clientId && c.apiKey && c.secretKey && c.contractNo && c.orderBaseUrl && c.printBaseUrl);
}
