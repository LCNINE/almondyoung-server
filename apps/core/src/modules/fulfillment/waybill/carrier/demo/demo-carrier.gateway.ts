import { createHash } from 'node:crypto';
import {
  type AllocateResult,
  type CarrierCapabilities,
  type CarrierCode,
  CarrierError,
  CarrierGateway,
  type CarrierScan,
  type RegisterOutcome,
  type WaybillRequest,
} from '../carrier-gateway.interface';

export type DemoCarrierRecordStatus = 'allocated' | 'registered' | 'canceled';

export interface DemoCarrierStoredRecord {
  requestHash: string;
  waybillNo: string;
  labelData: Record<string, unknown>;
  status: string;
}

export interface DemoCarrierStore {
  allocate(input: {
    requestKey: string;
    requestHash: string;
    waybillNo: string;
    labelData: Record<string, unknown>;
  }): Promise<DemoCarrierStoredRecord>;
  register(waybillNo: string): Promise<'registered' | 'already_registered' | 'missing'>;
  cancel(waybillNo: string): Promise<boolean>;
  track(waybillNo: string): Promise<{ status: string; updatedAt: Date } | null>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(req: WaybillRequest): string {
  return createHash('sha256').update(canonicalJson(req)).digest('hex');
}

function deterministicWaybillNo(key: string): string {
  const digest = createHash('sha256').update(`almondyoung-demo-waybill:${key}`).digest('hex');
  const suffix = (BigInt(`0x${digest.slice(0, 16)}`) % 100_000_000_000n).toString().padStart(11, '0');
  return `9${suffix}`;
}

export class DemoCarrierGateway extends CarrierGateway {
  override readonly carrier: CarrierCode = 'HANJIN';
  override readonly capabilities: CarrierCapabilities = Object.freeze({
    allocatesExternally: false,
    registersSeparately: true,
    canTrack: true,
    canCancel: true,
  });

  constructor(
    private readonly store: DemoCarrierStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  override isConfigured(): boolean {
    return true;
  }

  override async allocate(req: WaybillRequest): Promise<AllocateResult> {
    const hash = requestHash(req);
    const labelData: Record<string, unknown> = {
      s_tml_nam: 'DEMO ORIGIN',
      s_tml_cod: 'DEMO',
      zip_cod: req.recipient.zip,
      tml_nam: 'DEMO TERMINAL',
      tml_cod: 'DEMO',
      cen_nam: 'DEMO CENTER',
      cen_cod: 'DEMO01',
      pd_tim: '99',
      dom_rgn: 'D',
      hub_cod: 'DEMO',
      dom_mid: 'DEMO',
      grp_rnk: 'D01',
      es_nam: '시연용',
      es_cod: 'DEMO',
      prt_add: `${req.recipient.baseAddress} ${req.recipient.detailAddress}`.trim(),
      demo: true,
      allocatedAt: this.now().toISOString(),
    };
    const record = await this.store.allocate({
      requestKey: req.custOrdNo,
      requestHash: hash,
      waybillNo: deterministicWaybillNo(req.custOrdNo),
      labelData,
    });
    if (record.requestHash !== hash) {
      throw new CarrierError('Demo carrier request key was reused with a different payload', 'definitive_rejection', {
        carrier: 'demo',
        code: 'request_conflict',
      });
    }
    return { waybillNo: record.waybillNo, labelData: record.labelData };
  }

  override async register(waybillNo: string): Promise<RegisterOutcome> {
    const result = await this.store.register(waybillNo);
    if (result === 'registered' || result === 'already_registered') return { kind: result };
    return { kind: 'rejected', reason: 'Demo waybill was not allocated' };
  }

  override async cancel(waybillNo: string): Promise<void> {
    if (!(await this.store.cancel(waybillNo))) {
      throw new CarrierError('Demo waybill was not allocated', 'definitive_rejection', {
        carrier: 'demo',
        code: 'not_found',
      });
    }
  }

  override async track(waybillNo: string): Promise<CarrierScan[]> {
    const record = await this.store.track(waybillNo);
    if (!record) return [];
    const canceled = record.status === 'canceled';
    return [
      {
        statusCode: canceled ? '03' : '11',
        status: canceled ? 'canceled' : 'in_transit',
        occurredAt: record.updatedAt,
        location: '아몬드영 데모 물류센터',
        description: canceled ? '시연용 택배 취소' : '시연용 택배 접수',
      },
    ];
  }
}
