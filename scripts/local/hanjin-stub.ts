/**
 * 가짜 한진 — 로컬 core 가 실제 한진을 부르지 않게 한다(#1440, #1249 의 `fake-hanjin.ts` 를 옮긴 정본).
 *
 * `start-all.sh` 가 sms-stub 옆에서 띄우고, core 를 띄울 때 `HANJIN_ORDER_BASE_URL`·`HANJIN_PRINT_BASE_URL` 을
 * 이 주소로 덮는다(`E2E_HANJIN=real` 이면 둘 다 안 한다). 포트 정본은 `e2e-env-map.sh` 의 `E2E_HANJIN_STUB_PORT`.
 *
 *   npx tsx scripts/local/hanjin-stub.ts
 *
 * core 한진 게이트웨이(`apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway.ts`)가 부르는
 * 경로에 성공으로 답한다. 송장번호는 요청마다 다른 가짜 12자리(91 로 시작 — 로컬 시드 9000… 과 겹치지 않는다),
 * 분류 필드는 `scripts/local/seed-dev-core/outbound.ts` 의 `DEV_HANJIN_SORT_FIELDS` 꼴이다.
 * 서명 헤더는 검사하지 않고 찍지도 않는다(키가 실린다). 요청 경로만 찍는다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const HANJIN_STUB_HOST = '127.0.0.1';
export const HANJIN_STUB_PORT = 4599;

// scripts/local/seed-dev-core/outbound.ts DEV_HANJIN_SORT_FIELDS 와 같은 값
const SORT_FIELDS = {
  hub_cod: 'DV',
  tml_cod: '421',
  tml_nam: '부천',
  dom_mid: 'D',
  cen_cod: '4210',
  cen_nam: '부천(집)',
  grp_rnk: 'A1',
  es_nam: '개발기사',
  es_cod: '001',
  dom_rgn: '1',
  s_tml_cod: '421',
  s_tml_nam: '부천',
} as const;

/**
 * 요청마다 다른 12자리. 91 + 기동 시각(초)의 끝 6자리 + 4자리 순번 — 다시 띄워도 앞의 번호와 겹치지 않는다
 * (같은 초에 다시 띄우거나 한 번에 1만 장을 넘기지 않는 한).
 */
export function trackingNumbers(startedAtMs: number = Date.now()): () => string {
  const epoch = String(Math.floor(startedAtMs / 1000) % 1_000_000).padStart(6, '0');
  let n = 0;
  return () => {
    n += 1;
    return `91${epoch}${String(n % 10_000).padStart(4, '0')}`;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(isRecord(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function hanjinStubServer(nextTrackingNo: () => string = trackingNumbers()) {
  // 실제 한진처럼 재요청에 답한다 — 프로세스 메모리라 다시 띄우면 비지만, 번호는 기동 시각 접두라 겹치지 않는다.
  const numberByMsgKey = new Map<string, string>(); // 같은 msg_key 의 print-wbl 재요청 → 같은 번호
  const registered = new Set<string>(); // 출고(S) 등록된 custOrdNo → 다시 오면 ERROR-09(이미 등록)
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      const body = await readJson(req);
      let status = 200;
      let reply: unknown;
      let issued = '';

      if (req.method === 'POST' && /^\/v1\/wbl\/[^/]+\/print-wbl$/.test(path)) {
        // allocate — 송장번호 + 분류 필드 (snake_case)
        const msgKey = typeof body.msg_key === 'string' ? body.msg_key : '';
        issued = (msgKey && numberByMsgKey.get(msgKey)) || nextTrackingNo();
        if (msgKey) numberByMsgKey.set(msgKey, issued);
        reply = {
          result_code: 'OK',
          result_message: 'SUCCESS',
          wbl_num: issued,
          ...SORT_FIELDS,
          zip_cod: typeof body.rcv_zip === 'string' ? body.rcv_zip : '',
          prt_add: typeof body.address === 'string' ? body.address : '',
        };
      } else if (req.method === 'POST' && path === '/parcel-delivery/v1/order/insert-order') {
        // register(S) — 처음은 OK, 같은 custOrdNo 재전송은 ERROR-09. reservePickup(R) 은 회수 송장번호를 바로 싣는다
        const custOrdNo = typeof body.custOrdNo === 'string' ? body.custOrdNo : '';
        if (body.svcCatCd === 'R') {
          reply = { resultCode: 'OK', resultMessage: 'SUCCESS', wblNo: (issued = nextTrackingNo()) };
        } else if (custOrdNo && registered.has(custOrdNo)) {
          reply = { resultCode: 'ERROR-09', resultMessage: '이미 등록된 주문' };
        } else {
          if (custOrdNo) registered.add(custOrdNo);
          reply = { resultCode: 'OK', resultMessage: 'SUCCESS' };
        }
      } else if (req.method === 'POST' && path === '/parcel-delivery/v1/order/cancel-order') {
        reply = { resultCode: 'OK', resultMessage: 'SUCCESS' };
      } else if (req.method === 'POST' && path === '/parcel-delivery/v1/tracking/tracking-wbl') {
        // 집하 전 — 게이트웨이는 ERROR-01 을 빈 이력으로 읽는다
        reply = { resultCode: 'ERROR-01', resultMessage: '존재하지 않는 운송장번호' };
      } else {
        status = 404;
        reply = { resultCode: 'NOT_FAKED', resultMessage: `가짜 한진에 없는 경로: ${req.method} ${path}` };
      }

      console.log(`${new Date().toISOString()} ${req.method} ${path} ${status}${issued ? ` → ${issued}` : ''}`);
      send(res, status, reply);
    })();
  });
}

if (require.main === module) {
  const port = Number(process.env.E2E_HANJIN_STUB_PORT ?? HANJIN_STUB_PORT);
  const server = hanjinStubServer();
  server.listen(port, HANJIN_STUB_HOST, () => {
    console.log(`가짜 한진 http://${HANJIN_STUB_HOST}:${port} — Ctrl+C 로 끈다`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
