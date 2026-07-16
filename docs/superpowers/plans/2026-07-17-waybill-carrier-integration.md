# 운송장 캐리어 통합 계층 (플랜 1/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한진택배 self-print API를 감싸는 캐리어 통합 계층(캐리어 포트 + HMAC 서명 + HTTP 클라이언트 + 한진 어댑터)을 DB 무관·독립 테스트 가능한 단위로 구축한다.

**Architecture:** 추상 `CarrierGateway` 포트(2-step: `allocate`=채번/`register`=등록) 아래 `HanjinCarrierGateway`가 `HanjinApiClient`(native `fetch`+`AbortSignal.timeout`, 두 호스트)와 `HanjinHmacSigner`(순수 서명)를 조합한다. 상태·DB는 이 계층에 없다(플랜 2 소관). 한진 business 오류는 HTTP 200 + `resultCode`로 오므로, 클라이언트는 transport/HTTP만, 게이트웨이가 `resultCode` 의미를 정규화한다.

**Tech Stack:** NestJS, TypeScript, Node `crypto`(HMAC-SHA256), native `fetch`, zod(env), Jest.

**설계 근거:** `docs/superpowers/specs/2026-07-17-waybill-module-redesign-design.md` §6·§7. 이 플랜은 그 §6(캐리어 포트)·§7(한진 어댑터)만 구현한다. 상태머신/서비스/스키마/컨트롤러는 플랜 2, 컷오버는 플랜 3.

## Global Constraints

- HMAC: `message = timestamp + METHOD + queryString + secretKey`; `HMAC_SHA256(message, key=secretKey)` → **hex 소문자**. `secretKey`는 message에도·HMAC 키로도 쓰인다. body는 서명에 미포함.
- `timestamp` = `yyyyMMddHHmmss`, **Asia/Seoul(KST)**, `hourCycle: 'h23'`. message의 timestamp와 Authorization 헤더의 timestamp는 동일 값.
- `queryString` = URL `?` 뒤 원문 그대로(없으면 `''`). POST 엔드포인트는 모두 `''`.
- 헤더 3종: `Content-Type: application/json`, `x-api-key: {API Key}`, `Authorization: client_id={clientId} timestamp={ts} signature={sig}` (값 사이 공백).
- 두 호스트: order/tracking/customer = `HANJIN_ORDER_BASE_URL`(스테이징 `https://api-stg.hanjin.com`), print-wbl = `HANJIN_PRINT_BASE_URL`(스테이징 `https://ebbapd.hjt.co.kr`).
- `svcCatCd = 'S'`(자체출력) 고정. `resultCode`: `OK`→성공, `ERROR-09`(기등록 wblNo)→`already_registered`(멱등 성공), 그 외 `ERROR-xx`→`rejected`(definitive), HTTP 타임아웃/5xx/408/429→`unknown_outcome`.
- HTTP: native `fetch` + `AbortSignal.timeout(config.timeoutMs)`. axios/HttpModule 금지(house 패턴).
- 어댑터 계층 오류는 `CarrierError`(정규화 outcome)로 던진다. `@app/shared`/Nest 예외는 이 계층에서 쓰지 않는다(그건 플랜 2 서비스 계층).
- carrier 코드 값은 기존 `carrierEnum` = `['CJ','HANJIN','LOTTE','LOGEN','KDEXP','CJGLS']`.

---

## File Structure

```
apps/core/src/modules/fulfillment/waybill/carrier/
  carrier-gateway.interface.ts        # CarrierGateway(추상) + WaybillRequest/AllocateResult/RegisterOutcome/CarrierScan/CarrierError/CarrierCapabilities
  hanjin/
    hanjin.config.ts                  # HanjinConfig 타입 + loadHanjinConfig(env) + isHanjinConfigured()
    hanjin-hmac.signer.ts             # HanjinHmacSigner (순수 서명; clock 주입)
    hanjin-hmac.signer.spec.ts
    hanjin-api.client.ts              # HanjinApiClient (fetch+서명+두 호스트+HTTP 정규화)
    hanjin-api.client.spec.ts
    hanjin-carrier.gateway.ts         # HanjinCarrierGateway implements CarrierGateway
    hanjin-carrier.gateway.spec.ts
apps/core/src/config/env.validation.ts  # HANJIN_* zod 키 추가(additive)
```

각 파일 한 책임: 서명 / HTTP / 필드매핑·resultCode정규화 / 계약 타입. 게이트웨이 spec은 클라이언트를 mock하고, 클라이언트 spec은 `fetch`를 mock한다.

---

## Task 1: 환경설정 스키마 + HanjinConfig 로더

**Files:**
- Modify: `apps/core/src/config/env.validation.ts` (기존 `HANJIN_*` 블록에 additive 추가)
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.spec.ts`

**Interfaces:**
- Produces: `HanjinConfig` 타입, `loadHanjinConfig(env = process.env): HanjinConfig`, `isHanjinConfigured(c: HanjinConfig): boolean`.

```ts
export interface HanjinConfig {
  clientId: string;        // EDI 코드 (Authorization client_id)
  apiKey: string;          // x-api-key
  secretKey: string;       // HMAC 키
  contractNo: string;      // cntractNo / csr_num
  orderBaseUrl: string;    // api-stg host
  printBaseUrl: string;    // ebbapd host
  timeoutMs: number;
  sender: { name: string; zip: string; baseAddress: string; detailAddress: string; tel: string };
  boxType: string;         // boxTypCd 기본값
  payType: string;         // payTypCd 기본값
}
```

- [ ] **Step 1: env.validation.ts 에 zod 키 추가 (additive)**

기존 `HANJIN_API_URL/…/HANJIN_TIMEOUT_MS` 블록(48–55행) **아래**에 추가(기존 키는 플랜 3에서 제거):

```ts
    // Waybill(한진 self-print) — 신규 계약 (플랜 3에서 구 HANJIN_* 제거)
    HANJIN_CLIENT_ID: z.string().optional(),
    HANJIN_SECRET_KEY: z.string().optional(),
    HANJIN_CONTRACT_NO: z.string().optional(),
    HANJIN_ORDER_BASE_URL: z.string().url().optional(),
    HANJIN_PRINT_BASE_URL: z.string().url().optional(),
    HANJIN_SENDER_ZIP: z.string().optional(),
    HANJIN_SENDER_BASE_ADDR: z.string().optional(),
    HANJIN_SENDER_DTL_ADDR: z.string().optional(),
    HANJIN_SENDER_TEL: z.string().optional(),
    HANJIN_BOX_TYPE: z.string().optional(),
    HANJIN_PAY_TYPE: z.string().optional(),
```

(`HANJIN_API_KEY`, `HANJIN_SENDER_NAME`, `HANJIN_TIMEOUT_MS` 는 기존 것 재사용.)

- [ ] **Step 2: hanjin.config.ts 작성**

```ts
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
```

- [ ] **Step 3: 테스트 작성**

```ts
import { loadHanjinConfig, isHanjinConfigured } from './hanjin.config';

describe('hanjin.config', () => {
  it('필수 키가 모두 있으면 isHanjinConfigured=true', () => {
    const c = loadHanjinConfig({
      HANJIN_CLIENT_ID: 'EDI', HANJIN_API_KEY: 'k', HANJIN_SECRET_KEY: 's',
      HANJIN_CONTRACT_NO: '9117159', HANJIN_ORDER_BASE_URL: 'https://api-stg.hanjin.com',
      HANJIN_PRINT_BASE_URL: 'https://ebbapd.hjt.co.kr',
    } as NodeJS.ProcessEnv);
    expect(isHanjinConfigured(c)).toBe(true);
    expect(c.boxType).toBe('A');      // 기본값
    expect(c.payType).toBe('PP');
    expect(c.timeoutMs).toBe(15000);
  });

  it('secretKey 누락 시 isHanjinConfigured=false', () => {
    const c = loadHanjinConfig({ HANJIN_CLIENT_ID: 'EDI', HANJIN_API_KEY: 'k' } as NodeJS.ProcessEnv);
    expect(isHanjinConfigured(c)).toBe(false);
  });
});
```

- [ ] **Step 4: 테스트 실행**

Run: `npm run test -- --testPathPattern=hanjin.config` (jest 설정은 package.json 내장, 별도 config 없음)
Expected: PASS 2건.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/config/env.validation.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config.spec.ts
git commit -m "feat(waybill): 한진 캐리어 설정 스키마 + 로더"
```

---

## Task 2: 캐리어 포트 인터페이스

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts`

**Interfaces:**
- Produces (플랜 2·게이트웨이가 소비): `CarrierGateway`, `WaybillRequest`, `AllocateResult`, `RegisterOutcome`, `CarrierScan`, `CarrierCapabilities`, `CarrierError`.

- [ ] **Step 1: 인터페이스 파일 작성**

```ts
import { carrierEnum } from '../../inventory/schema/inventory.schema';

export type CarrierCode = (typeof carrierEnum.enumValues)[number];

export interface WaybillRequest {
  custOrdNo: string; // ≤30B, 우리 상관키(주문번호)
  recipient: {
    name: string; zip: string; baseAddress: string; detailAddress: string;
    tel?: string; mobile?: string; message?: string;
  };
  sender: { name: string; zip: string; baseAddress: string; detailAddress: string; tel?: string };
  items: Array<{ name: string; code?: string; quantity: number }>;
  commodityName: string; // comodityNm 요약(대표 상품명)
  boxType: string;       // boxTypCd
  payType: string;       // payTypCd
}

export interface AllocateResult {
  waybillNo: string;
  labelData: Record<string, unknown>; // carrier-tagged blob (한진 분류필드)
}

export type RegisterOutcome =
  | { kind: 'registered' }
  | { kind: 'already_registered' } // 한진 ERROR-09 → 멱등 성공
  | { kind: 'rejected'; reason: string };

export type CarrierScanStatus = 'pending' | 'in_transit' | 'delivered' | 'failed' | 'canceled';

export interface CarrierScan {
  statusCode: string;
  status: CarrierScanStatus;
  occurredAt: Date;
  location?: string;
  description?: string;
  reasonCode?: string;
  reasonMessage?: string;
}

export type CarrierErrorOutcome = 'definitive_rejection' | 'unknown_outcome';

export class CarrierError extends Error {
  override readonly name = 'CarrierError';
  constructor(
    message: string,
    readonly outcome: CarrierErrorOutcome,
    readonly details: { carrier?: string; code?: string; httpStatus?: number; cause?: unknown } = {},
  ) {
    super(message);
  }
}

export interface CarrierCapabilities {
  allocatesExternally: boolean; // 외부 채번(print-wbl)
  registersSeparately: boolean; // 별도 등록(insert-order)
  canTrack: boolean;
  canCancel: boolean;
}

export abstract class CarrierGateway {
  abstract readonly carrier: CarrierCode;
  abstract readonly capabilities: CarrierCapabilities;
  abstract isConfigured(): boolean;
  abstract allocate(req: WaybillRequest): Promise<AllocateResult>;
  abstract register(waybillNo: string, req: WaybillRequest): Promise<RegisterOutcome>;
  track?(waybillNo: string): Promise<CarrierScan[]>;
  cancel?(waybillNo: string, req: WaybillRequest): Promise<void>;
}
```

- [ ] **Step 2: 빌드로 타입 검증**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 에러 없음(새 파일이 컴파일됨).

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface.ts
git commit -m "feat(waybill): 캐리어 포트 인터페이스(2-step capability)"
```

---

## Task 3: HanjinHmacSigner (골든 벡터 TDD)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer.spec.ts`

**Interfaces:**
- Consumes: `HanjinConfig`(Task 1).
- Produces: `HanjinHmacSigner`(생성자 `(creds: {clientId,apiKey,secretKey}, now?: () => Date)`), `sign(method: string, url: string): { 'Content-Type': string; 'x-api-key': string; Authorization: string }`.

- [ ] **Step 1: 실패 테스트 작성 (한진 공식 골든 벡터)**

```ts
import { HanjinHmacSigner } from './hanjin-hmac.signer';

describe('HanjinHmacSigner', () => {
  const creds = { clientId: 'HANJIN', apiKey: 'test-key', secretKey: 'RAXGVUWSBvmnARzoYsylxcBLvdVm1GUzWRslNYKGKdadStnCnAJFGPUbyvHNcVmD' };
  // 공식 가이드 실행결과: message "20231009152839GET" + query + secret → 아래 서명
  // 20231009152839 KST = 2023-10-09T06:28:39Z
  const fixedNow = () => new Date('2023-10-09T06:28:39.000Z');

  it('GET+쿼리 서명이 공식 골든 벡터와 일치(소문자 hex)', () => {
    const signer = new HanjinHmacSigner(creds, fixedNow);
    const headers = signer.sign('GET', 'https://api-stg.hanjin.com/parcel-delivery/v1/customer/customer-check?cntractNo=9771759');
    expect(headers.Authorization).toBe(
      'client_id=HANJIN timestamp=20231009152839 signature=576f6c59d7f60872c94c05b2e2d69ab056ff1e1ff9fee110a6ebadf3d96664bf',
    );
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('POST(쿼리 없음)는 message에 queryString이 빈 문자열', () => {
    const signer = new HanjinHmacSigner(creds, fixedNow);
    const headers = signer.sign('POST', 'https://api-stg.hanjin.com/parcel-delivery/v1/order/insert-order');
    // 수동 재현: HMAC_SHA256("20231009152839POST" + secret, key=secret) 의 hex 소문자
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', creds.secretKey).update('20231009152839POST' + creds.secretKey, 'utf8').digest('hex');
    expect(headers.Authorization).toBe(`client_id=HANJIN timestamp=20231009152839 signature=${expected}`);
  });

  it('KST 포맷: UTC 15:00 → 익일 00시대 (h23)', () => {
    const signer = new HanjinHmacSigner(creds, () => new Date('2023-10-09T15:00:05.000Z'));
    const headers = signer.sign('POST', 'https://x/y');
    expect(headers.Authorization).toContain('timestamp=20231010000005');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- hanjin-hmac.signer`
Expected: FAIL ("Cannot find module './hanjin-hmac.signer'").

- [ ] **Step 3: 구현 작성**

```ts
import { createHmac } from 'crypto';

export interface HanjinSignerCredentials {
  clientId: string;
  apiKey: string;
  secretKey: string;
}

export interface HanjinSignedHeaders {
  'Content-Type': string;
  'x-api-key': string;
  Authorization: string;
}

export class HanjinHmacSigner {
  constructor(
    private readonly creds: HanjinSignerCredentials,
    private readonly now: () => Date = () => new Date(),
  ) {}

  sign(method: string, url: string): HanjinSignedHeaders {
    const timestamp = this.kstTimestamp(this.now());
    const queryString = this.queryString(url);
    const message = timestamp + method.toUpperCase() + queryString + this.creds.secretKey;
    const signature = createHmac('sha256', this.creds.secretKey).update(message, 'utf8').digest('hex');
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.creds.apiKey,
      Authorization: `client_id=${this.creds.clientId} timestamp=${timestamp} signature=${signature}`,
    };
  }

  private queryString(url: string): string {
    const i = url.indexOf('?');
    return i >= 0 ? url.slice(i + 1) : '';
  }

  private kstTimestamp(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
    return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- hanjin-hmac.signer`
Expected: PASS 3건. 골든 벡터 서명이 `576f6c59…664bf` 로 일치.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer.spec.ts
git commit -m "feat(waybill): 한진 HMAC 서명(공식 골든 벡터 검증)"
```

---

## Task 4: HanjinApiClient (fetch + 서명 + 두 호스트 + HTTP 정규화)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client.spec.ts`

**Interfaces:**
- Consumes: `HanjinConfig`(Task 1), `HanjinHmacSigner`(Task 3), `CarrierError`(Task 2).
- Produces: `HanjinApiClient`(생성자 `(config: HanjinConfig, signer: HanjinHmacSigner)`), `post(host: 'order'|'print', path: string, body: unknown): Promise<any>`, `get(host: 'order'|'print', path: string, query: Record<string,string>): Promise<any>`. 반환은 파싱된 JSON(HTTP 200). transport/비200 → `CarrierError`.

- [ ] **Step 1: 실패 테스트 작성 (fetch mock)**

```ts
import { HanjinApiClient } from './hanjin-api.client';
import { HanjinHmacSigner } from './hanjin-hmac.signer';
import { CarrierError } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';

const config = {
  clientId: 'HANJIN', apiKey: 'k', secretKey: 's', contractNo: '9117159',
  orderBaseUrl: 'https://api-stg.hanjin.com', printBaseUrl: 'https://ebbapd.hjt.co.kr',
  timeoutMs: 15000, sender: { name: 'wh', zip: '08588', baseAddress: 'a', detailAddress: 'b', tel: '02-1' },
  boxType: 'A', payType: 'PP',
} as HanjinConfig;

function client() { return new HanjinApiClient(config, new HanjinHmacSigner(config, () => new Date('2023-10-09T06:28:39Z'))); }

describe('HanjinApiClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('post: order 호스트 URL·서명 헤더로 호출하고 200 JSON 반환', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resultCode: 'OK' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const body = await client().post('order', '/parcel-delivery/v1/order/insert-order', { custOrdNo: 'X' });
    expect(body).toEqual({ resultCode: 'OK' });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api-stg.hanjin.com/parcel-delivery/v1/order/insert-order');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers.Authorization).toContain('client_id=HANJIN timestamp=20231009152839 signature=');
  });

  it('get: print 호스트 + 쿼리 직렬화(서명은 쿼리 포함 URL로)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resultCode: 'OK' }), { status: 200 }),
    );
    await client().get('order', '/parcel-delivery/v1/customer/customer-check', { cntractNo: '9117159' });
    expect(spy.mock.calls[0][0]).toBe('https://api-stg.hanjin.com/parcel-delivery/v1/customer/customer-check?cntractNo=9117159');
  });

  it('타임아웃(fetch reject) → CarrierError unknown_outcome', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'unknown_outcome' });
  });

  it('HTTP 500 → unknown_outcome, HTTP 400 → definitive_rejection', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('err', { status: 500 }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'unknown_outcome' });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'definitive_rejection' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- hanjin-api.client`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

```ts
import { CarrierError } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';
import type { HanjinHmacSigner } from './hanjin-hmac.signer';

type HanjinHost = 'order' | 'print';

export class HanjinApiClient {
  constructor(
    private readonly config: HanjinConfig,
    private readonly signer: HanjinHmacSigner,
  ) {}

  async post(host: HanjinHost, path: string, body: unknown): Promise<any> {
    return this.request('POST', host, path, undefined, body);
  }

  async get(host: HanjinHost, path: string, query: Record<string, string> = {}): Promise<any> {
    return this.request('GET', host, path, query, undefined);
  }

  private baseUrl(host: HanjinHost): string {
    return host === 'print' ? this.config.printBaseUrl : this.config.orderBaseUrl;
  }

  private async request(
    method: 'GET' | 'POST',
    host: HanjinHost,
    path: string,
    query: Record<string, string> | undefined,
    body: unknown,
  ): Promise<any> {
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
    const url = `${this.baseUrl(host)}${path}${qs}`;
    const headers = this.signer.sign(method, url); // 서명은 쿼리 포함 URL로

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new CarrierError('Hanjin request did not produce a definitive response', 'unknown_outcome', {
        carrier: 'hanjin',
        code: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport_error',
        cause: error,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const details = { carrier: 'hanjin', code: `http_${response.status}`, httpStatus: response.status };
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new CarrierError(`Hanjin request outcome is unknown: ${response.status} - ${text}`, 'unknown_outcome', details);
      }
      throw new CarrierError(`Hanjin request was rejected: ${response.status} - ${text}`, 'definitive_rejection', details);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new CarrierError('Hanjin returned an invalid JSON response', 'unknown_outcome', {
        carrier: 'hanjin',
        code: 'invalid_response',
        httpStatus: response.status,
        cause: error,
      });
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- hanjin-api.client`
Expected: PASS 4건.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client.spec.ts
git commit -m "feat(waybill): 한진 API 클라이언트(fetch+서명+HTTP 정규화)"
```

---

## Task 5: HanjinCarrierGateway — allocate (print-wbl)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts`

**Interfaces:**
- Consumes: `CarrierGateway`/`WaybillRequest`/`AllocateResult`/`CarrierError`(Task 2), `HanjinApiClient`(Task 4), `HanjinConfig`(Task 1).
- Produces: `HanjinCarrierGateway`(생성자 `(config: HanjinConfig, client: HanjinApiClient)`) — 이 Task에서는 `carrier`/`capabilities`/`isConfigured`/`allocate` 구현. `register`/`track`은 Task 6·7에서 채움(이 Task에선 `throw new Error('not implemented')` 스텁으로 두되, 테스트는 allocate만).

- [ ] **Step 1: 실패 테스트 작성 (client mock)**

```ts
import { HanjinCarrierGateway } from './hanjin-carrier.gateway';
import { CarrierError, type WaybillRequest } from '../carrier-gateway.interface';
import type { HanjinConfig } from './hanjin.config';

const config = {
  clientId: 'HANJIN', apiKey: 'k', secretKey: 's', contractNo: '9117159',
  orderBaseUrl: 'https://api-stg.hanjin.com', printBaseUrl: 'https://ebbapd.hjt.co.kr',
  timeoutMs: 15000, sender: { name: '창고', zip: '08588', baseAddress: '금천구', detailAddress: '지점', tel: '02-1' },
  boxType: 'A', payType: 'PP',
} as HanjinConfig;

const req: WaybillRequest = {
  custOrdNo: 'SO-1',
  recipient: { name: '김택배', zip: '04532', baseAddress: '서울시 중구 소공로 88', detailAddress: '999층', tel: '02-2', mobile: '010-2' },
  sender: config.sender,
  items: [{ name: '의류', code: 'A1', quantity: 1 }],
  commodityName: '의류', boxType: 'A', payType: 'PP',
};

function gateway(clientStub: any) { return new HanjinCarrierGateway(config, clientStub); }

describe('HanjinCarrierGateway.allocate', () => {
  it('print-wbl OK → waybillNo + labelData(분류필드)', async () => {
    const post = jest.fn().mockResolvedValue({
      result_code: 'OK', wbl_num: '531647410114', s_tml_cod: '442', tml_cod: '150', cen_cod: '1050',
      grp_rnk: 'Z99', es_nam: '김한진', prt_add: '소공동 51', dom_rgn: '1',
    });
    const res = await gateway({ post }).allocate(req);
    expect(res.waybillNo).toBe('531647410114');
    expect(res.labelData).toMatchObject({ tml_cod: '150', cen_cod: '1050', es_nam: '김한진' });
    // print 호스트 + custOrdNo=msg_key 로 호출
    expect(post).toHaveBeenCalledWith('print', '/v1/wbl/HANJIN/print-wbl', expect.objectContaining({
      client_id: 'HANJIN', csr_num: '9117159', snd_zip: '08588', rcv_zip: '04532', msg_key: 'SO-1',
    }));
  });

  it('print-wbl ERROR-xx → CarrierError definitive_rejection', async () => {
    const post = jest.fn().mockResolvedValue({ result_code: 'ERROR-04', result_message: '유효하지 않은 주소' });
    await expect(gateway({ post }).allocate(req)).rejects.toMatchObject({ outcome: 'definitive_rejection', details: { code: 'ERROR-04' } });
  });

  it('capabilities / carrier / isConfigured', () => {
    const g = gateway({ post: jest.fn() });
    expect(g.carrier).toBe('HANJIN');
    expect(g.capabilities).toEqual({ allocatesExternally: true, registersSeparately: true, canTrack: true, canCancel: false });
    expect(g.isConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성 (allocate + 골격)**

```ts
import {
  AllocateResult, CarrierCapabilities, CarrierCode, CarrierError, CarrierGateway,
  RegisterOutcome, WaybillRequest,
} from '../carrier-gateway.interface';
import { HanjinConfig, isHanjinConfigured } from './hanjin.config';
import type { HanjinApiClient } from './hanjin-api.client';

const LABEL_FIELDS = [
  's_tml_nam','s_tml_cod','zip_cod','tml_nam','tml_cod','cen_nam','cen_cod','pd_tim',
  'dom_rgn','hub_cod','dom_mid','grp_rnk','es_nam','es_cod','prt_add',
] as const;

export class HanjinCarrierGateway extends CarrierGateway {
  override readonly carrier: CarrierCode = 'HANJIN';
  override readonly capabilities: CarrierCapabilities = Object.freeze({
    allocatesExternally: true, registersSeparately: true, canTrack: true, canCancel: false,
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
    const res = await this.client.post('print', `/v1/wbl/${this.config.clientId}/print-wbl`, body);
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

  override async register(_waybillNo: string, _req: WaybillRequest): Promise<RegisterOutcome> {
    throw new Error('not implemented — Task 6');
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: PASS 3건.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts
git commit -m "feat(waybill): 한진 게이트웨이 allocate(print-wbl) + 골격"
```

---

## Task 6: HanjinCarrierGateway — register (insert-order, ERROR-09 멱등)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts` (register 구현)
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts` (register 테스트 추가)

**Interfaces:**
- Produces: `HanjinCarrierGateway.register(waybillNo, req): Promise<RegisterOutcome>` — `OK`→`{kind:'registered'}`, `ERROR-09`→`{kind:'already_registered'}`, 그 외 `ERROR-xx`→`{kind:'rejected'}`. HTTP/transport 오류는 `CarrierError`(client가 던짐)로 전파.

- [ ] **Step 1: 실패 테스트 추가**

```ts
describe('HanjinCarrierGateway.register', () => {
  const today = () => new Date('2023-10-09T06:28:39Z');
  it('insert-order OK → registered, order 호스트·svcCatCd=S·wblNo 전달', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'OK', resultMessage: 'SUCCESS' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    const out = await g.register('531647410114', req);
    expect(out).toEqual({ kind: 'registered' });
    expect(post).toHaveBeenCalledWith('order', '/parcel-delivery/v1/order/insert-order', expect.objectContaining({
      custEdiCd: 'HANJIN', custOrdNo: 'SO-1', wblNo: '531647410114', svcCatCd: 'S',
      cntractNo: '9117159', pickupAskDt: '20231009', payTypCd: 'PP', boxTypCd: 'A', comodityNm: '의류',
    }));
  });

  it('insert-order ERROR-09(기등록) → already_registered (멱등 성공)', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-09', resultMessage: '기등록 운송장번호' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    expect(await g.register('531647410114', req)).toEqual({ kind: 'already_registered' });
  });

  it('insert-order ERROR-06 → rejected(reason)', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-06', resultMessage: '유효하지 않은 수하인 주소' });
    const g = new HanjinCarrierGateway(config, { post } as any, today);
    expect(await g.register('531647410114', req)).toEqual({ kind: 'rejected', reason: 'ERROR-06: 유효하지 않은 수하인 주소' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: FAIL (register가 'not implemented' throw + 생성자 3번째 인자 미지원).

- [ ] **Step 3: 구현 — 생성자에 clock 주입 + register/pickupAskDt**

생성자에 `now` 추가하고 `register` 구현:

```ts
  constructor(
    private readonly config: HanjinConfig,
    private readonly client: HanjinApiClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    super();
  }

  override async register(waybillNo: string, req: WaybillRequest): Promise<RegisterOutcome> {
    const body = {
      custEdiCd: this.config.clientId,
      custOrdNo: req.custOrdNo,
      wblNo: waybillNo,
      svcCatCd: 'S',
      cntractNo: this.config.contractNo,
      pickupAskDt: this.kstDate(this.now()),
      sndrZip: req.sender.zip, sndrBaseAddr: req.sender.baseAddress, sndrDtlAddr: req.sender.detailAddress,
      sndrNm: req.sender.name, sndrTelNo: req.sender.tel ?? '',
      rcvrZip: req.recipient.zip, rcvrBaseAddr: req.recipient.baseAddress, rcvrDtlAddr: req.recipient.detailAddress,
      rcvrNm: req.recipient.name, rcvrTelNo: req.recipient.tel ?? '', rcvrMobileNo: req.recipient.mobile ?? '',
      rcvrAskCntent: req.recipient.message ?? '',
      comodityNm: req.commodityName,
      payTypCd: req.payType, boxTypCd: req.boxType,
      comodityList: req.items.map((it) => ({ comodityCd: it.code ?? '', comodityNm: it.name, comodityCnt: String(it.quantity) })),
    };
    const res = await this.client.post('order', '/parcel-delivery/v1/order/insert-order', body);
    if (res?.resultCode === 'OK') return { kind: 'registered' };
    if (res?.resultCode === 'ERROR-09') return { kind: 'already_registered' };
    return { kind: 'rejected', reason: `${res?.resultCode ?? 'UNKNOWN'}: ${res?.resultMessage ?? ''}`.trim() };
  }

  private kstDate(d: Date): string {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)!.value;
    return `${get('year')}${get('month')}${get('day')}`;
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: PASS (allocate 3 + register 3).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts
git commit -m "feat(waybill): 한진 게이트웨이 register(insert-order, ERROR-09 멱등)"
```

---

## Task 7: HanjinCarrierGateway — track (tracking-wbl → CarrierScan[])

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts` (track 구현)
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts` (track 테스트 추가)

**Interfaces:**
- Produces: `HanjinCarrierGateway.track(waybillNo): Promise<CarrierScan[]>` — `wrkList`를 `CarrierScan[]`로 매핑. statusCode→status: `01/05`→pending, `07/08/11/14/31/32/63`→in_transit, `65/66`→delivered, `92`→failed, `03`→canceled. `resultCode='ERROR-01'`(스캔 없음/미존재)→`[]`.

- [ ] **Step 1: 실패 테스트 추가**

```ts
describe('HanjinCarrierGateway.track', () => {
  it('wrkList → CarrierScan[] (statusCode 매핑)', async () => {
    const post = jest.fn().mockResolvedValue({
      resultCode: 'OK', wblNo: '777', wrkList: [
        { statusCode: '11', statusName: '집하완료', statusDate: '2023-07-29 19:10:00', agencyName: '구로(집)', description: 'x' },
        { statusCode: '66', statusName: '배송완료', statusDate: '2023-07-30 15:20:00', reasonCode: '01', reasonMessage: '본인' },
      ],
    });
    const scans = await new HanjinCarrierGateway(config, { post } as any).track('777');
    expect(scans).toHaveLength(2);
    expect(scans[0]).toMatchObject({ statusCode: '11', status: 'in_transit' });
    expect(scans[1]).toMatchObject({ statusCode: '66', status: 'delivered', reasonMessage: '본인' });
    expect(post).toHaveBeenCalledWith('order', '/parcel-delivery/v1/tracking/tracking-wbl', { custEdiCd: 'HANJIN', wblNo: '777' });
  });

  it('ERROR-01(스캔 없음) → 빈 배열', async () => {
    const post = jest.fn().mockResolvedValue({ resultCode: 'ERROR-01', resultMessage: '존재하지 않는 운송장번호' });
    expect(await new HanjinCarrierGateway(config, { post } as any).track('777')).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: FAIL (track 미구현 — 옵셔널 메서드 없음).

- [ ] **Step 3: 구현 추가**

```ts
import { CarrierScan, CarrierScanStatus } from '../carrier-gateway.interface';

const STATUS_MAP: Record<string, CarrierScanStatus> = {
  '01': 'pending', '05': 'pending',
  '07': 'in_transit', '08': 'in_transit', '11': 'in_transit', '14': 'in_transit',
  '31': 'in_transit', '32': 'in_transit', '63': 'in_transit',
  '65': 'delivered', '66': 'delivered',
  '92': 'failed', '03': 'canceled',
};

// (클래스 메서드로 추가)
  override async track(waybillNo: string): Promise<CarrierScan[]> {
    const res = await this.client.post('order', '/parcel-delivery/v1/tracking/tracking-wbl', {
      custEdiCd: this.config.clientId, wblNo: waybillNo,
    });
    if (res?.resultCode === 'ERROR-01') return [];
    const list: any[] = Array.isArray(res?.wrkList) ? res.wrkList : [];
    return list.map((w) => ({
      statusCode: String(w.statusCode ?? ''),
      status: STATUS_MAP[String(w.statusCode)] ?? 'pending',
      occurredAt: new Date(String(w.statusDate ?? '').replace(' ', 'T') + '+09:00'),
      location: w.agencyName || undefined,
      description: w.description || undefined,
      reasonCode: w.reasonCode || undefined,
      reasonMessage: w.reasonMessage || undefined,
    }));
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- hanjin-carrier.gateway`
Expected: PASS (allocate 3 + register 3 + track 2).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.spec.ts
git commit -m "feat(waybill): 한진 게이트웨이 track(tracking-wbl 매핑)"
```

---

## Task 8: 전체 계층 빌드·테스트 그린 확인

**Files:** (변경 없음 — 통합 검증)

- [ ] **Step 1: 계층 전체 유닛 테스트**

Run: `npm run test -- waybill/carrier`
Expected: 4개 spec(config/signer/client/gateway) 전부 PASS.

- [ ] **Step 2: core 빌드**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: lint(변경 파일 스코프)**

Run: `npx eslint apps/core/src/modules/fulfillment/waybill --max-warnings=0`
Expected: 새 파일에 신규 error 없음. (repo 전역 lint debt는 스코프 밖 — 메모리 `lint-scope-caveat` 참조)

- [ ] **Step 4: (해당 시) 커밋**

수정이 있었으면 커밋. 없으면 스킵.

---

## 후속 플랜 (이 플랜 범위 밖)

- **플랜 2 — 도메인 계층**: `waybills` 스키마(additive) + `waybillStatusEnum`/`waybillSourceEnum` + `WaybillIssueMachine`(drive: pending→allocated→registered, abandon 비대칭) + `WaybillService/Manager/Reader`(issue/issueBatch/registerManual/void/reissue/assertDispatchable/markUsed/getActiveWaybill) + DTO + `WaybillController` + `WaybillModule`. 이 플랜의 `CarrierGateway`를 소비.
- **플랜 3 — 컷오버(contract)**: 소비자 9파일 rewire(InvoiceOrchestrator→WaybillService), 오케스트레이터/provider/워커/구 HANJIN_* env 삭제, `invoices`/`invoiceOperations` drop, 구 `hanjin-delivery.provider*`·`goodsflow-delivery.provider*`·`delivery-provider.interface` 삭제.

## Self-Review 체크

- **스펙 커버리지**: §6 포트 → Task 2 ✓. §7.1 HMAC → Task 3(골든 벡터) ✓. §7.2 allocate/register/track → Task 5·6·7 ✓. §7.3 설정·isConfigured → Task 1·5 ✓. resultCode 정규화(OK/ERROR-09/거절) → Task 6 ✓. track statusCode 매핑 → Task 7 ✓. (customer-check health `verifyContract`는 플랜 2에서 `isConfigured` 심화 시 추가 — 이 플랜은 env-presence `isConfigured`까지.)
- **타입 일관성**: `CarrierGateway.allocate/register/track` 시그니처가 Task 2 정의와 Task 5·6·7 구현 일치. `HanjinApiClient.post(host,path,body)` 시그니처가 Task 4 정의와 Task 5·6·7 호출 일치. `HanjinCarrierGateway` 생성자는 Task 6에서 3번째 인자(`now`)를 추가하며, Task 5 테스트는 2-인자 형태를 쓰므로 `now`는 기본값 필수(구현에 반영됨).
- **플레이스홀더**: 없음(Task 5의 register 스텁은 Task 6에서 대체되는 의도된 순차 구현).
