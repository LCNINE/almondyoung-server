// apps/medusa/integration-tests/http/fixtures/return-fixture.ts
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createServer, Server } from 'http';
import jwt from 'jsonwebtoken';
import type { Commerce } from './partial-cancel-fixture';

export const CORE_PORT = 39132;
export const CORE_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
export const CORE_INTERNAL_KEY = 'test-core-key';

/** exchangeable 을 안 주면 true 로 답한다 — 지금 core 는 인쇄 줄만 false 라 일반 상품 주문의 기본값이다(K8 PR11b). 옛 core(칸 없음)는 단위 스펙이 본다 */
type EligibilityLine = { channelOrderItemId: string; deliveredUnits: number; lastDeliveredAt: string | null; exchangeable?: boolean };

/**
 * core 의 `POST /internal/sales-orders/return-eligibility` 스텁(K8 PR3 Task 1).
 * 모르는 주문은 실제 core 처럼 `{ found: false, lines: [] }` 로 답한다 — 셀메이트 시기 라이브와 같은 모양이다.
 */
export class FakeCore {
  server?: Server;
  calls: Array<{ externalOrderId: string; authorization: string | undefined }> = [];
  private eligibility = new Map<string, EligibilityLine[]>();
  private customerReturns = new Map<string, Array<{ channelReturnId: string; status: string; kind?: 'return' | 'exchange'; exchangeReleased?: boolean }>>();
  private failStatus: number | null = null;
  /** `customer-return-pickup/release` 호출 기록(K8 PR9). 정하지 않은 반품은 404(옛 core) — 기존 스펙은 그대로 취소된다. */
  releaseCalls: Array<{ channelReturnId: string; authorization: string | undefined }> = [];
  private pickupRelease = new Map<string, 'released' | 'picked_up' | 'exchange_released'>();
  private releaseFailStatus: number | null = null;

  constructor(private readonly port = CORE_PORT) {}

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        const externalOrderId = String(parsed.externalOrderId ?? '');
        if (req.method === 'POST' && req.url === '/internal/sales-orders/return-eligibility') {
          this.calls.push({ externalOrderId, authorization: req.headers.authorization });
        }
        if (req.method === 'POST' && req.url === '/internal/sales-orders/customer-return-pickup/release') {
          const channelReturnId = String(parsed.channelReturnId ?? '');
          this.releaseCalls.push({ channelReturnId, authorization: req.headers.authorization });
          const result = this.pickupRelease.get(channelReturnId);
          const out =
            this.releaseFailStatus !== null
              ? { status: this.releaseFailStatus, payload: { message: 'injected' } }
              : result
                ? { status: 200, payload: { result } }
                : { status: 404, payload: { message: 'no route' } };
          res.writeHead(out.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out.payload));
          return;
        }
        const { status, payload } = this.route(req.method ?? 'GET', req.url ?? '/', externalOrderId);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((r) => this.server!.listen(this.port, '127.0.0.1', r));
  }
  async stop() {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
  reset() {
    this.calls = [];
    this.eligibility.clear();
    this.customerReturns.clear();
    this.failStatus = null;
    this.releaseCalls = [];
    this.pickupRelease.clear();
    this.releaseFailStatus = null;
  }
  /** 그 반품의 회수 놓아주기 결과. 안 정하면 404 다. */
  setPickupRelease(returnId: string, result: 'released' | 'picked_up' | 'exchange_released') {
    this.pickupRelease.set(returnId, result);
  }
  /** 숫자면 회수 놓아주기를 그 상태로 거절한다(모든 반품). null 이면 정상으로 돌아온다. */
  failPickupReleaseWith(status: number | null) {
    this.releaseFailStatus = status;
  }
  setEligibility(orderId: string, lines: EligibilityLine[]) {
    this.eligibility.set(orderId, lines);
  }
  /** 그 주문의 core 반품 예정 기록(자격 응답의 `customerReturns`). 안 정하면 빈 배열이다. */
  setCustomerReturns(orderId: string, rows: Array<{ channelReturnId: string; status: string; kind?: 'return' | 'exchange'; exchangeReleased?: boolean }>) {
    this.customerReturns.set(orderId, rows);
  }
  /** 숫자면 그 상태로 거절한다(모든 주문). null 이면 정상으로 돌아온다. */
  failWith(status: number | null) {
    this.failStatus = status;
  }

  private route(method: string, url: string, externalOrderId: string): { status: number; payload: unknown } {
    if (method !== 'POST' || url !== '/internal/sales-orders/return-eligibility') {
      return { status: 404, payload: { message: url } };
    }
    if (this.failStatus !== null) return { status: this.failStatus, payload: { message: 'injected' } };
    const lines = this.eligibility.get(externalOrderId)?.map((l) => ({ ...l, exchangeable: l.exchangeable ?? true }));
    const customerReturns = this.customerReturns.get(externalOrderId) ?? [];
    return { status: 200, payload: lines ? { found: true, lines, customerReturns } : { found: false, lines: [], customerReturns: [] } };
  }
}

let customerSeq = 0;

/** 고객 하나 + 그 고객으로 인증된 스토어 헤더(publishable key 포함). */
export async function customerHeaders(
  container: any,
  c: Commerce,
): Promise<{ customerId: string; headers: { headers: Record<string, string> } }> {
  customerSeq++;
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
  const secret = config.projectConfig.http.jwtSecret;
  const [customer] = await container
    .resolve(Modules.CUSTOMER)
    .createCustomers([{ email: `returner${customerSeq}-${Date.now()}@return.test` }]);
  const token = jwt.sign(
    { actor_id: customer.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: customer.id } },
    secret,
  );
  return {
    customerId: customer.id as string,
    headers: { headers: { ...c.storeHeaders.headers, authorization: `Bearer ${token}` } },
  };
}

/** placeOrder 는 손님 주문을 만든다 — 고객 소유 확인을 보려면 주문을 고객에게 붙인다. */
export async function assignOrderToCustomer(container: any, orderId: string, customerId: string) {
  await container.resolve(Modules.ORDER).updateOrders([{ id: orderId, customer_id: customerId }]);
}
