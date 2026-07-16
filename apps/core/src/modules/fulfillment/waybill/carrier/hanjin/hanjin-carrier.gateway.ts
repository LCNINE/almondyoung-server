import {
  AllocateResult,
  CarrierCapabilities,
  CarrierCode,
  CarrierError,
  CarrierGateway,
  RegisterOutcome,
  WaybillRequest,
} from '../carrier-gateway.interface';
import { HanjinConfig, isHanjinConfigured } from './hanjin.config';
import type { HanjinApiClient } from './hanjin-api.client';

const LABEL_FIELDS = [
  's_tml_nam',
  's_tml_cod',
  'zip_cod',
  'tml_nam',
  'tml_cod',
  'cen_nam',
  'cen_cod',
  'pd_tim',
  'dom_rgn',
  'hub_cod',
  'dom_mid',
  'grp_rnk',
  'es_nam',
  'es_cod',
  'prt_add',
] as const;

// print-wbl 응답(snake_case). 분류필드는 인덱스 시그니처로 접근.
interface PrintWblResponse {
  result_code?: string;
  result_message?: string;
  wbl_num?: string | number;
  [key: string]: unknown;
}

export class HanjinCarrierGateway extends CarrierGateway {
  override readonly carrier: CarrierCode = 'HANJIN';
  override readonly capabilities: CarrierCapabilities = Object.freeze({
    allocatesExternally: true,
    registersSeparately: true,
    canTrack: true,
    canCancel: false,
  });

  constructor(
    private readonly config: HanjinConfig,
    private readonly client: HanjinApiClient,
  ) {
    super();
  }

  override isConfigured(): boolean {
    return isHanjinConfigured(this.config);
  }

  override async allocate(req: WaybillRequest): Promise<AllocateResult> {
    const body = {
      client_id: this.config.clientId,
      csr_num: this.config.contractNo,
      address: `${req.recipient.baseAddress} ${req.recipient.detailAddress}`.trim(),
      snd_zip: req.sender.zip,
      rcv_zip: req.recipient.zip,
      msg_key: req.custOrdNo,
    };
    const res = await this.client.post<PrintWblResponse>('print', `/v1/wbl/${this.config.clientId}/print-wbl`, body);
    if (res?.result_code !== 'OK' || !res?.wbl_num) {
      throw new CarrierError(
        `Hanjin print-wbl rejected: ${res?.result_code} - ${res?.result_message ?? ''}`,
        'definitive_rejection',
        { carrier: 'hanjin', code: res?.result_code ?? 'no_wbl_num' },
      );
    }
    const labelData: Record<string, unknown> = {};
    for (const f of LABEL_FIELDS) if (res[f] !== undefined) labelData[f] = res[f];
    return { waybillNo: String(res.wbl_num), labelData };
  }

  override register(): Promise<RegisterOutcome> {
    throw new Error('not implemented — Task 6');
  }
}
