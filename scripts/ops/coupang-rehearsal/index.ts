/**
 * 쿠팡 리허설 — 읽기 전용 수집. DB·Kafka 에 닿지 않는다. 사용법은 README.md.
 * 🔴 첫 줄에서 읽기 전용을 켠다: 클라이언트가 GET 이 아닌 호출을 보내기 전에 throw 한다.
 */
process.env.COUPANG_READ_ONLY = 'true';

import { execFileSync } from 'child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, isAbsolute } from 'path';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { CoupangOrderClient } from '../../../apps/channel-adapter/src/adapters/coupang/clients/coupang-order.client.service';
import { CoupangReturnClient } from '../../../apps/channel-adapter/src/adapters/coupang/clients/coupang-return.client.service';
import {
  CoupangCancelReceiptReader,
  CoupangOrderSheetReader,
  CoupangOrderSource,
} from '../../../apps/channel-adapter/src/services/order-collection/coupang-order.source';
import { parseCoupangOrderSheet } from '../../../apps/channel-adapter/src/services/order-collection/coupang-order-fields';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

/** 아직 없는 경로도 가장 가까운 존재하는 조상의 realpath 로 풀어 심볼릭 링크로 레포 안에 들어오는 것을 막는다. */
function realpathLoose(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(realpathLoose(parent), absolute.slice(parent.length + 1));
  }
}

function assertOutsideRepo(out: string): void {
  const top = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const rel = relative(top, realpathLoose(out));
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (inside) {
    console.error('--out 이 레포 안이다. 원 응답에는 실제 고객 정보가 들어 있어 레포 밖에만 쓴다.');
    process.exit(2);
  }
}

/** 클라이언트 앞에서 응답을 파일로 남기는 얇은 포트 구현. 상품준비중 처리는 막는다 — 리허설은 읽기만 한다. */
class RecordingOrderReader implements CoupangOrderSheetReader {
  readonly singles: unknown[] = [];
  readonly scans: Record<string, readonly unknown[]> = {};
  constructor(private readonly inner: CoupangOrderClient) {}

  async getAllOrderSheetsByStatus(from: string, to: string, status: string): Promise<readonly unknown[]> {
    const rows = await this.inner.getAllOrderSheetsByStatus(from, to, status);
    this.scans[status] = rows;
    return rows;
  }

  async getSingleOrderSheetByOrderId(orderId: string): Promise<{ data?: readonly unknown[] | null }> {
    const response = await this.inner.getSingleOrderSheetByOrderId(orderId);
    this.singles.push(response);
    return response;
  }

  acknowledgeOrdersheets(): never {
    throw new Error('리허설은 상품준비중 처리를 부르지 않는다');
  }
}

class RecordingReceiptReader implements CoupangCancelReceiptReader {
  readonly pages: unknown[] = [];
  constructor(private readonly inner: CoupangReturnClient) {}

  async getReturnRequests(params: Parameters<CoupangCancelReceiptReader['getReturnRequests']>[0]) {
    const response = await this.inner.getReturnRequests(params);
    this.pages.push({ params, response });
    return response;
  }
}

function writeRaw(rawDir: string, name: string, value: unknown): void {
  writeFileSync(join(rawDir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}

async function main(): Promise<void> {
  const out = argValue('out');
  if (!out) {
    console.error('사용법: index.ts --out=<레포 밖 디렉터리>');
    process.exit(2);
  }
  assertOutsideRepo(out);
  const rawDir = join(resolve(out), 'raw');
  mkdirSync(rawDir, { recursive: true });

  const http = new HttpService(axios.create());
  const orders = new RecordingOrderReader(new CoupangOrderClient(http));
  const receipts = new RecordingReceiptReader(new CoupangReturnClient(http));
  const source = new CoupangOrderSource(orders, receipts);

  const result = await source.fetchOrdersInWindow(null);

  for (const [status, rows] of Object.entries(orders.scans)) writeRaw(rawDir, `order-sheets-${status}`, rows);
  writeRaw(rawDir, 'order-sheets-single', orders.singles);
  receipts.pages.forEach((page, index) => writeRaw(rawDir, `receipts-${index + 1}`, page));

  // 화면 보고. 주문번호는 사무실 화면에만 나온다.
  const accept = orders.scans.ACCEPT ?? [];
  const instruct = orders.scans.INSTRUCT ?? [];
  const parseFailures: string[] = [];
  const acceptOrderIds = new Set<string>();
  const unshipped: string[] = [];
  const twoLineOrders: string[] = [];
  for (const raw of accept) {
    try {
      acceptOrderIds.add(parseCoupangOrderSheet(raw).orderId);
    } catch (error) {
      parseFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const raw of instruct) {
    try {
      const info = parseCoupangOrderSheet(raw);
      const row = asRecord(raw);
      if (!row.invoiceNumber) unshipped.push(`${info.orderId}/${info.shipmentBoxId}`);
      const optionIds = info.items.map((item) => item.vendorItemId);
      if (new Set(optionIds).size !== optionIds.length) twoLineOrders.push(info.orderId);
    } catch (error) {
      parseFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.log(`결제완료 = 넘겨받을 주문 ${acceptOrderIds.size}건: ${[...acceptOrderIds].join(', ')}`);
  console.log(`상품준비중이면서 송장 없는 상자 ${unshipped.length}건: ${unshipped.join(', ')}`);
  console.log(`해석 실패 ${parseFailures.length}건`);
  parseFailures.forEach((message) => console.log(`  - ${message}`));
  console.log(`같은 옵션 두 줄 주문 ${twoLineOrders.length}건: ${twoLineOrders.join(', ')}`);
  console.log(
    `source 결과: 주문 ${result.snapshots.length}건, 수집 실패 ${result.fetchFailures.length}건, 창 끝 ${result.completedWindowEnd?.toISOString() ?? '없음'}`,
  );
  result.fetchFailures.forEach((failure) => console.log(`  - ${JSON.stringify(failure)}`));
  console.log(`원 응답: ${rawDir} (자료 만든 뒤 지운다)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
