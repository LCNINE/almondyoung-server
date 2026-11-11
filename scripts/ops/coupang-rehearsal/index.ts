/**
 * 쿠팡 리허설 — 읽기 전용 수집. DB·Kafka 에 닿지 않는다. 사용법은 README.md.
 * 🔴 첫 줄에서 읽기 전용을 켠다: 클라이언트가 GET 이 아닌 호출을 보내기 전에 throw 한다.
 */
process.env.COUPANG_READ_ONLY = 'true';

import { execFileSync } from 'child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { CoupangOrderClient } from '../../../apps/channel-adapter/src/adapters/coupang/clients/coupang-order.client.service';
import { CoupangReturnClient } from '../../../apps/channel-adapter/src/adapters/coupang/clients/coupang-return.client.service';
import {
  CoupangCancelReceiptReader,
  CoupangOrderSheetReader,
  CoupangOrderSource,
} from '../../../apps/channel-adapter/src/services/order-collection/coupang-order.source';
import { isInsideRepo, realpathLoose } from './repo-guard';
import { parseCoupangOrderSheet } from '../../../apps/channel-adapter/src/services/order-collection/coupang-order-fields';
import { summarizeOrders } from './report';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function assertOutsideRepo(out: string): void {
  // 프로세스 cwd 가 아니라 이 스크립트가 있는 디렉터리의 레포를 기준으로 한다.
  const top = realpathSync(
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim(),
  );
  if (isInsideRepo(top, realpathLoose(out))) {
    console.error('--out 이 레포 안이다. 원 응답에는 실제 고객 정보가 들어 있어 레포 밖에만 쓴다.');
    process.exit(2);
  }
}

/** 받은 응답을 바로 파일로 쓴다 — 도중에 throw 해도 그때까지 받은 것은 남는다. */
class RawWriter {
  private counter = 0;
  constructor(private readonly rawDir: string) {}
  write(name: string, value: unknown): void {
    this.counter += 1;
    const file = `${String(this.counter).padStart(3, '0')}-${name}.json`;
    writeFileSync(join(this.rawDir, file), `${JSON.stringify(value, null, 2)}\n`);
  }
}

/** 클라이언트 앞에서 응답을 남기는 얇은 포트 구현. 상품준비중 처리는 막는다 — 리허설은 읽기만 한다. */
class RecordingOrderReader implements CoupangOrderSheetReader {
  readonly scans: Record<string, readonly unknown[]> = {};
  /** 주문번호 → 단건 조회 응답의 발주서 전부 */
  readonly singles = new Map<string, readonly unknown[]>();
  constructor(
    private readonly inner: CoupangOrderClient,
    private readonly raw: RawWriter,
  ) {}

  async getAllOrderSheetsByStatus(from: string, to: string, status: string): Promise<readonly unknown[]> {
    const rows = await this.inner.getAllOrderSheetsByStatus(from, to, status);
    this.scans[status] = rows;
    this.raw.write(`order-sheets-${status}`, rows);
    return rows;
  }

  async getSingleOrderSheetByOrderId(orderId: string): Promise<{ data?: readonly unknown[] | null }> {
    const response = await this.inner.getSingleOrderSheetByOrderId(orderId);
    this.raw.write('order-sheet-single', response);
    this.singles.set(orderId, response.data ?? []);
    return response;
  }

  acknowledgeOrdersheets(): never {
    throw new Error('리허설은 상품준비중 처리를 부르지 않는다');
  }
}

class RecordingReceiptReader implements CoupangCancelReceiptReader {
  constructor(
    private readonly inner: CoupangReturnClient,
    private readonly raw: RawWriter,
  ) {}

  async getReturnRequests(params: Parameters<CoupangCancelReceiptReader['getReturnRequests']>[0]) {
    const response = await this.inner.getReturnRequests(params);
    this.raw.write('receipts', { params, response });
    return response;
  }
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
  const raw = new RawWriter(rawDir);
  const orders = new RecordingOrderReader(new CoupangOrderClient(http), raw);
  const receipts = new RecordingReceiptReader(new CoupangReturnClient(http), raw);
  const source = new CoupangOrderSource(orders, receipts);

  const result = await source.fetchOrdersInWindow(null);

  // 화면 보고. 주문번호는 사무실 화면에만 나온다.
  const accept = orders.scans.ACCEPT ?? [];
  const instruct = orders.scans.INSTRUCT ?? [];
  const parseFailures: string[] = [];
  const acceptOrderIds = new Set<string>();
  const instructOrderIds = new Set<string>();
  const unshipped: string[] = [];
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
      instructOrderIds.add(info.orderId);
      const row = asRecord(raw);
      if (!row.invoiceNumber) unshipped.push(`${info.orderId}/${info.shipmentBoxId}`);
    } catch (error) {
      parseFailures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // 결제완료 주문도 단건 조회한다(GET — 목록이 작다). 결제완료 스캔에는 이미 출고된 다른 상자가 안 보인다 —
  // 그런 주문은 컷오버에서 사람이 처리하므로(런북) 숫자가 보여야 한다. source 가 이미 단건 조회한 주문은 다시 묻지 않는다.
  const singleFetchFailures: string[] = [];
  for (const orderId of acceptOrderIds) {
    if (orders.singles.has(orderId)) continue;
    try {
      await orders.getSingleOrderSheetByOrderId(orderId);
    } catch (error) {
      singleFetchFailures.push(`${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const sheetsByOrder = new Map<string, readonly unknown[]>();
  for (const orderId of new Set([...acceptOrderIds, ...instructOrderIds])) {
    const sheets = orders.singles.get(orderId);
    if (sheets) sheetsByOrder.set(orderId, sheets);
  }
  const report = summarizeOrders({ acceptOrderIds, sheetsByOrder });

  console.log(`결제완료 = 넘겨받을 주문 ${acceptOrderIds.size}건: ${[...acceptOrderIds].join(', ')}`);
  console.log(
    `결제완료이면서 출고(DEPARTURE 이후)된 상자가 섞인 주문 ${report.acceptWithShippedBox.length}건 (사람이 처리): ${report.acceptWithShippedBox.join(', ')}`,
  );
  console.log(`상품준비중이면서 송장 없는 상자 ${unshipped.length}건: ${unshipped.join(', ')}`);
  console.log(`해석 실패 ${parseFailures.length + report.parseFailures.length}건`);
  [...parseFailures, ...report.parseFailures].forEach((message) => console.log(`  - ${message}`));
  console.log(`단건 조회 실패 ${singleFetchFailures.length}건 (아래 숫자에서 빠졌다)`);
  singleFetchFailures.forEach((message) => console.log(`  - ${message}`));
  console.log(
    `같은 옵션 두 줄 주문(주문의 상자 전부 기준) ${report.twoLineOrders.length}건: ${report.twoLineOrders.join(', ')}`,
  );
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
