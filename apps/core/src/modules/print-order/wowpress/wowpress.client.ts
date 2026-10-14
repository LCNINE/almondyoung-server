import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { splitKoreanAddress } from './korean-address';
import { httpsWowpressTransport } from './wowpress.transport';
import {
  type WowpressLineSpec,
  type WowpressOrderDetail,
  type WowpressOrderInput,
  type WowpressRequest,
  type WowpressResponse,
  type WowpressTransport,
} from './wowpress.types';

const API_BASE = 'https://api.wowpress.co.kr';
const FILE_BASE = 'https://file.wowpress.co.kr';
export const WOWPRESS_TRANSPORT = Symbol('WOWPRESS_TRANSPORT');

export class WowpressApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WowpressApiError';
  }
}

export class WowpressUnauthorizedError extends WowpressApiError {
  constructor() {
    super('unauthorized');
    this.name = 'WowpressUnauthorizedError';
  }
}

const commonResponse = z.object({
  resultCode: z.union([z.string(), z.number()]).transform(String),
  errMsg: z.string().nullish(),
  token: z.string().nullish(),
  resultMap: z.unknown().optional(),
});
type CommonResponse = z.infer<typeof commonResponse>;

const record = z.record(z.string(), z.unknown());
const recordArray = z.array(z.unknown());
const numeric = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d+)?$/),
  ])
  .transform(Number);

function asRecord(v: unknown): Record<string, unknown> | null {
  const r = record.safeParse(v);
  return r.success ? r.data : null;
}

function firstRecord(v: unknown): Record<string, unknown> | null {
  const arr = recordArray.safeParse(v);
  return arr.success ? asRecord(arr.data[0]) : null;
}

function toNumber(v: unknown): number | null {
  const r = numeric.safeParse(v);
  return r.success ? r.data : null;
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function pick<T>(sources: (Record<string, unknown> | null)[], key: string, read: (v: unknown) => T | null): T | null {
  for (const s of sources) {
    const v = s ? read(s[key]) : null;
    if (v !== null) return v;
  }
  return null;
}

function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

// 응답 전체에서 ordnum 값만 모은다. 본문은 고객 개인정보를 담으므로 통째로 남기지 않는다
function collectOrdnums(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectOrdnums(item, out);
    return out;
  }
  const r = asRecord(node);
  if (!r) return out;
  for (const [key, value] of Object.entries(r)) {
    if (key === 'ordnum') {
      const n = nonEmptyString(value);
      if (n) out.push(n);
    } else {
      collectOrdnums(value, out);
    }
  }
  return out;
}

@Injectable()
export class WowpressClient {
  private readonly logger = new Logger(WowpressClient.name);
  private token: string | null = null;
  private readonly transport: WowpressTransport;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(WOWPRESS_TRANSPORT) transport?: WowpressTransport,
  ) {
    this.transport = transport ?? httpsWowpressTransport;
  }

  async quote(spec: WowpressLineSpec, qty: number): Promise<void> {
    await this.call(
      {
        method: 'POST',
        url: `${API_BASE}/api/v1/ord/cjson_jobcost`,
        json: {
          prodno: spec.prodno,
          ordqty: String(spec.qtyPerUnit * qty),
          ordcnt: '1',
          ordtitle: 'quote',
          prsjob: spec.prsjob,
          awkjob: spec.awkjob,
        },
      },
      true,
    );
  }

  async order(input: WowpressOrderInput): Promise<{ ordnum: string }> {
    const { spec, receiver } = input;
    const res = await this.call(
      {
        method: 'POST',
        url: `${API_BASE}/api/v1/ord/cjson_order`,
        json: {
          action: 'ord',
          ordreq: [
            [
              {
                prodno: spec.prodno,
                ordqty: String(spec.qtyPerUnit * input.qty),
                ordcnt: '1',
                ordtitle: input.ordtitle,
                ordbody: input.ordbody,
                ordkey: input.ordkey,
                jobpresetno: spec.jobpresetno,
                prsjob: spec.prsjob,
                awkjob: spec.awkjob,
              },
            ],
          ],
          dlvymcd: '4',
          dlvyfr: this.sender(),
          dlvyto: {
            name: receiver.name,
            tel: receiver.tel,
            zipcode: receiver.zipcode,
            ...splitKoreanAddress(receiver.addr1),
            addr1: receiver.addr1,
            addr2: receiver.addr2,
            dlvymsg: receiver.dlvymsg,
          },
        },
      },
      false,
      { name: 'cjson_order', ordkey: input.ordkey },
    );
    // ponytail: ordnum 의 정확한 위치는 첫 실주문 응답으로 확인한다
    const resultMap = asRecord(res.resultMap);
    const ordinfo = firstRecord(asRecord(resultMap?.cjson_order)?.ordinfo);
    const ordnum = nonEmptyString(ordinfo?.ordnum) ?? nonEmptyString(resultMap?.ordnum);
    if (!ordnum) throw new WowpressApiError('ordnum missing in cjson_order response');
    return { ordnum };
  }

  async uploadFileUrl(ordnum: string, filename: string, fileurl: string): Promise<void> {
    await this.call(
      { method: 'POST', url: `${FILE_BASE}/api/v1/file/uploadurl`, form: { ordnum, filename, fileurl } },
      false,
    );
  }

  async cancel(ordnum: string): Promise<void> {
    await this.call({ method: 'POST', url: `${API_BASE}/api/v1/ord/ord_cancel`, json: { ordnum } }, false);
  }

  async findByOrdkey(ordkey: string, since: Date): Promise<{ ordnum: string } | null> {
    const res = await this.call(
      {
        method: 'POST',
        url: `${API_BASE}/api/v1/ord/ord_list`,
        json: {
          stdt: kstDate(since),
          eddt: kstDate(new Date()),
          ordkey,
          validord: 'N',
          recordCountPerPage: 100,
        },
      },
      true,
      { name: 'ord_list', ordkey },
    );
    // ponytail: 목록 배열의 키는 문서 예시가 없어 ord_list·list 둘 다 받고, 둘 다 아니면 실패시킨다
    const resultMap = asRecord(res.resultMap);
    const ordList = recordArray.safeParse(resultMap?.ord_list);
    const list = ordList.success ? ordList : recordArray.safeParse(resultMap?.list);
    // 모르는 모양을 null 로 보면 재주문(중복 결제)으로 이어지므로, 배열을 읽은 경우만 '없음' 으로 본다
    if (!list.success) throw new WowpressApiError('unrecognized ord_list response');
    // 행을 모두 먼저 검사한다. ordkey 칸이 없는 행을 '불일치' 로 넘기면 같은 이유로 재주문이 된다
    const rows = list.data.map((row) => {
      const r = asRecord(row);
      const key = r && Object.hasOwn(r, 'ordkey') ? r.ordkey : undefined;
      if (!r || !(typeof key === 'string' || typeof key === 'number' || key === null)) {
        throw new WowpressApiError('unrecognized ord_list row');
      }
      return { r, key: key === null ? null : String(key) };
    });
    const ordnums = new Set<string>();
    for (const { r, key } of rows) {
      if (key !== ordkey) continue;
      const ordnum = nonEmptyString(r.ordnum);
      // null 은 재주문으로 이어지므로, 주문은 있는데 번호를 못 읽으면 중복 결제를 막으려 실패시킨다
      if (!ordnum) throw new WowpressApiError('ordnum missing for matching ordkey');
      ordnums.add(ordnum);
    }
    const [first, ...rest] = ordnums;
    if (first === undefined) return null;
    if (rest.length > 0) throw new WowpressApiError(`multiple ordnums for ordkey: ${[first, ...rest].join(', ')}`);
    return { ordnum: first };
  }

  async detail(ordnum: string): Promise<WowpressOrderDetail> {
    const res = await this.call(
      {
        method: 'GET',
        url: `${API_BASE}/api/v1/ord/order/${encodeURIComponent(ordnum)}`,
      },
      true,
    );
    const root = asRecord(res.resultMap);
    const sources = [root, firstRecord(root?.ordinfo), firstRecord(root?.dlvinfo)];
    const ordstat = pick(sources, 'ordstat', toNumber);
    if (ordstat === null) throw new WowpressApiError(`ordstat missing in order detail ${ordnum}`);
    return {
      ordstat,
      jobstat: pick(sources, 'jobstat', toNumber),
      dlvyno: pick(sources, 'dlvyno', toNumber),
      dlvyinvc: pick(sources, 'dlvyinvc', nonEmptyString),
    };
  }

  private sender() {
    const get = (key: string): string => {
      const v = this.config.get<string>(key);
      if (!v) throw new WowpressApiError(`${key} is not configured`);
      return v;
    };
    const addr1 = get('WOWPRESS_SENDER_ADDR1');
    return {
      name: get('WOWPRESS_SENDER_NAME'),
      tel: get('WOWPRESS_SENDER_TEL'),
      zipcode: get('WOWPRESS_SENDER_ZIPCODE'),
      ...splitKoreanAddress(addr1),
      addr1,
      addr2: this.config.get<string>('WOWPRESS_SENDER_ADDR2') ?? '',
    };
  }

  private async issueToken(): Promise<string> {
    const authUid = this.config.get<string>('WOWPRESS_AUTH_UID');
    const authPw = this.config.get<string>('WOWPRESS_AUTH_PW');
    if (!authUid || !authPw) throw new WowpressApiError('WOWPRESS_AUTH_UID/WOWPRESS_AUTH_PW is not configured');
    const res = this.ensureOk(
      await this.transport({ method: 'GET', url: `${API_BASE}/api/login/issue`, json: { authUid, authPw } }),
    );
    if (!res.token) throw new WowpressApiError('token missing in login/issue response');
    this.token = res.token;
    return res.token;
  }

  // 다시 보내면 주문·파일 전달·취소가 두 번 나갈 수 있어, 401 재발급 후 재전송은 조회성 호출에만 한다
  private async call(
    req: Omit<WowpressRequest, 'token'>,
    resendOn401: boolean,
    audit?: { name: string; ordkey: string },
  ): Promise<CommonResponse> {
    let token = this.token ?? (await this.issueToken());
    let res = await this.send({ ...req, token }, audit);
    if (res.status === 401) {
      this.token = null;
      if (!resendOn401) throw new WowpressUnauthorizedError();
      token = await this.issueToken();
      res = await this.send({ ...req, token }, audit);
    }
    return this.ensureOk(res);
  }

  private async send(req: WowpressRequest, audit?: { name: string; ordkey: string }): Promise<WowpressResponse> {
    const res = await this.transport(req);
    if (audit) this.logOrdnums(audit, res.body);
    return res;
  }

  private logOrdnums(audit: { name: string; ordkey: string }, body: unknown): void {
    const ordnums = collectOrdnums(body);
    if (ordnums.length > 0) {
      this.logger.log(`wowpress ${audit.name} ordkey=${audit.ordkey} ordnum=${[...new Set(ordnums)].join(',')}`);
    }
  }

  private ensureOk(res: { status: number; body: unknown }): CommonResponse {
    const parsed = commonResponse.safeParse(res.body);
    const errMsg = parsed.success ? parsed.data.errMsg : null;
    if (res.status < 200 || res.status >= 300) throw new WowpressApiError(errMsg || `HTTP ${res.status}`);
    if (!parsed.success) throw new WowpressApiError('unexpected wowpress response body');
    if (parsed.data.resultCode !== '200') throw new WowpressApiError(errMsg || `resultCode ${parsed.data.resultCode}`);
    return parsed.data;
  }
}
