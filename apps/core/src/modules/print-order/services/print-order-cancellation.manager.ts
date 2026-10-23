import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, UpstreamUnavailableError } from '@app/shared';
import { type DbTx } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressApiError, WowpressClient, WowpressUnauthorizedError } from '../wowpress/wowpress.client';
import { WOWPRESS_CANCELLABLE, WOWPRESS_STATUS_CANCELLED, type WowpressOrderDetail } from '../wowpress/wowpress.types';
import { WOWPRESS_DEADLINE_MS } from '../wowpress/wowpress.transport';
import { ORDER_LOOKUP_PENDING_ERROR, ORDER_UNCONFIRMED_ERROR } from './print-order-submit.manager';
import { PrintOrderReader } from './print-order.reader';
import { isPreservedLastError, PrintOrderRepository } from './print-order.repository';

export const PRINT_IN_PRODUCTION_MESSAGE =
  '주문하신 인쇄물이 이미 제작에 들어가 취소할 수 없습니다. 인쇄물에 불량이 있으면 받으신 날부터 5일 안에 고객센터로 문의해 주세요.';
export const PRINT_CANCEL_RETRY_MESSAGE = '잠시 후 다시 시도해 주세요.';
export const PRINT_SHIPPED_MESSAGE = '이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.';
export const PRINT_PARTIAL_QUANTITY_MESSAGE =
  '인쇄 주문 상품은 일부 수량만 취소할 수 없습니다. 상품 전체 수량으로 취소해 주세요.';

export class PrintInProductionError extends ConflictError {
  constructor() {
    super(PRINT_IN_PRODUCTION_MESSAGE);
  }

  getErrorCode(): string {
    return 'PRINT_IN_PRODUCTION';
  }
}

export class PrintShippedError extends ConflictError {
  constructor() {
    super(PRINT_SHIPPED_MESSAGE);
  }

  getErrorCode(): string {
    return 'PRINT_SHIPPED';
  }
}

export const PRINT_PARTIAL_CANCEL_AVAILABLE_MESSAGE =
  '주문하신 인쇄 상품은 이미 제작에 들어가 취소할 수 없습니다. 인쇄 상품을 뺀 나머지 상품만 취소할 수 있습니다.';

// 고객 취소 1단계 응답. 스토어는 이 코드를 받으면 안내창을 띄우고, 동의하면 excludePrint 로 다시 요청한다
export class PrintPartialCancelAvailableError extends ConflictError {
  constructor() {
    super(PRINT_PARTIAL_CANCEL_AVAILABLE_MESSAGE);
  }

  getErrorCode(): string {
    return 'PRINT_PARTIAL_CANCEL_AVAILABLE';
  }
}

export const PRINT_NEEDS_PARTIAL_CANCEL_MESSAGE =
  '아몬드템플릿 인쇄 상품이 있는 주문은 금액만으로 환불할 수 없습니다. 주문내역 > 주문 취소 > 부분 취소에서 환불할 상품을 골라 주세요.';

// 금액만 아는 환불 경로는 어느 상품을 돌려주는지 몰라, 인쇄를 멋대로 취소하거나 인쇄분까지 환불하게 된다
export class PrintNeedsPartialCancelError extends ConflictError {
  constructor() {
    super(PRINT_NEEDS_PARTIAL_CANCEL_MESSAGE);
  }

  getErrorCode(): string {
    return 'PRINT_NEEDS_PARTIAL_CANCEL';
  }
}

export const SHIPPED_BEFORE_CANCEL_ERROR = 'sales order cancelled after print shipped — check return/refund';

export type PrintCancelMode = 'gate' | 'record';
export interface PrintCancelOptions {
  // 고객 취소: 와우프레스가 거절하면 고객에게 바로 알리고 인쇄는 계속하므로, 운영자 확인(cancel_refused)으로 넘기지 않는다
  keepOnRefusal?: boolean;
  // record: 이미 처리한 같은 취소 이벤트가 다시 왔으면 그 이벤트를 처음 기록한 시각.
  // 그 뒤에 운영자가 마무리한 행은 이 이벤트에 대한 결정이므로 뒤집지 않는다. 그 전의 마무리는 다른 취소에 대한 것이다
  redeliveredSince?: Date;
}
export interface PrintCancelLine {
  salesOrderLineId: string;
  quantity: number;
}
export interface PrintCancelResult {
  vendorCancelled: string[];
  locallyCancelled: string[];
}

// 취소 요청이 응답을 기다리는 최대 시간보다 넉넉히 길어야, 아직 살아 있는 다른 요청의 표시를 빼앗지 않는다
export const CANCEL_CLAIM_STALE_MS = Math.max(5 * 60_000, 4 * WOWPRESS_DEADLINE_MS);

type Outcome = 'done' | 'refused' | 'busy' | 'unavailable' | 'shipped';
type VendorState = 'cancelled' | 'cancellable' | 'refused';
interface Run {
  mode: PrintCancelMode;
  result: PrintCancelResult;
  keepOnRefusal: boolean;
}

const MAX_REREADS = 3;

const Rank = { blocker: 0, vendor: 1, local: 2, done: 3 } as const;

const TERMINAL_FOR_CANCEL = ['cancelled', 'cancel_refused', 'shipped', 'delivered'];
const SETTLED_FOR_CANCEL = ['cancel_refused', 'shipped', 'delivered'];

function isOperatorResolved(row: PrintOrderRow): boolean {
  return row.status === 'cancelled' && row.cancelResolvedAt !== null;
}

// 우리가 아는 와우프레스 주문을 취소했어도(cancelled) 중복 의심·번호 미저장 기록이 있으면 다른 주문이 살아 있을 수 있다.
// 운영자가 와우프레스에서 취소를 확인해 마무리한 행(cancel_resolved_at)은 예외다
function needsOperator(row: PrintOrderRow): boolean {
  if (isOperatorResolved(row)) return false;
  return !SETTLED_FOR_CANCEL.includes(row.status) && isPreservedLastError(row.lastError);
}

function rank(row: PrintOrderRow): number {
  if (isPreservedLastError(row.lastError)) return Rank.blocker;
  if (row.status === 'cancelled') return Rank.done;
  if (['shipped', 'delivered', 'submitting', 'cancel_refused'].includes(row.status)) return Rank.blocker;
  if (row.vendorOrderNumber) return Rank.vendor;
  if (row.orderAttemptedAt) return Rank.blocker;
  return Rank.local;
}

function vendorState(detail: WowpressOrderDetail): VendorState {
  if (detail.ordstat === WOWPRESS_STATUS_CANCELLED) return 'cancelled';
  return WOWPRESS_CANCELLABLE(detail) ? 'cancellable' : 'refused';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const cancelQuantityExceedsMessage = (requested: number, remaining: number) =>
  `취소 수량(${requested}개)이 취소 가능 수량(${remaining}개)을 초과합니다.`;

@Injectable()
export class PrintOrderCancellationManager {
  private readonly logger = new Logger(PrintOrderCancellationManager.name);

  constructor(
    private readonly reader: PrintOrderReader,
    private readonly repository: PrintOrderRepository,
    private readonly wowpress: WowpressClient,
  ) {}

  async cancelForOrder(
    salesOrderId: string,
    mode: PrintCancelMode,
    lines?: PrintCancelLine[],
    options: PrintCancelOptions = {},
  ): Promise<PrintCancelResult> {
    const run: Run = {
      mode,
      result: { vendorCancelled: [], locallyCancelled: [] },
      keepOnRefusal: mode === 'gate' && options.keepOnRefusal === true,
    };
    const all = await this.reader.forSalesOrder(salesOrderId);
    const requested = lines ? this.requestedQuantities(lines, mode) : null;
    const rows = requested ? all.filter((r) => requested.has(r.salesOrderLineId)) : all;
    if (rows.length === 0) return run.result;
    const partial = requested ? await this.partialLineIds(salesOrderId, rows, requested, mode) : new Set<string>();

    if (mode === 'record') {
      for (const row of rows) {
        // 재전달된 같은 취소 이벤트만 운영자 마무리를 존중한다. 새 취소는 다시 와우프레스 취소를 시도하고, 거절되면 운영자에게 다시 넘긴다
        if (
          options.redeliveredSince &&
          row.cancelResolvedAt !== null &&
          row.cancelResolvedAt >= options.redeliveredSince
        ) {
          this.logger.log(`print order ${row.id} cancel already resolved by operator; record skipped`);
          continue;
        }
        if (partial.has(row.id)) await this.record(row, 'partial quantity cancelled on channel — decide on WowPress');
        else await this.cancelRow(row, run);
      }
      return run.result;
    }

    if (partial.size > 0) throw new BadRequestError(PRINT_PARTIAL_QUANTITY_MESSAGE);
    try {
      await this.gate(rows, run);
    } catch (error) {
      await this.noteSalesCancelFailed(run.result, error);
      throw error;
    }
    return run.result;
  }

  // record 전에 판매주문 취소와 같은 트랜잭션에서 부른다. 커밋 뒤 cancelForOrder 까지의 틈에 발주되지 않게 한다
  holdUnsent(salesOrderId: string, lines: PrintCancelLine[] | undefined, tx: DbTx): Promise<void> {
    return this.repository.holdUnsentForCancel(
      salesOrderId,
      lines?.map((l) => l.salesOrderLineId),
      tx,
    );
  }

  // 채널 수량 감소를 받은 트랜잭션에서 부른다. 감소가 대기로 남는 동안 그 줄의 안 보낸 인쇄가 원래 수량으로 주문되지 않게 한다
  holdForDecrease(salesOrderLineId: string, tx: DbTx): Promise<void> {
    return this.repository.holdUnsentForDecrease(salesOrderLineId, tx);
  }

  // 인쇄를 멈춘 뒤 판매주문 취소가 실패한 마지막 시각과 사유를 남긴다. 보드 판정은 판매주문 줄의 남은 수량으로 한다
  async noteSalesCancelFailed(result: PrintCancelResult, cause: unknown): Promise<void> {
    const notes = [
      ...result.vendorCancelled.map((id) => [id, `wowpress cancelled but sales cancel failed: ${errorMessage(cause)}`]),
      ...result.locallyCancelled.map((id) => [
        id,
        `print order cancelled but sales cancel failed: ${errorMessage(cause)}`,
      ]),
    ];
    for (const [id, lastError] of notes) {
      this.logger.error(`print order ${id}: ${lastError}`);
      await this.repository.update(id, { lastError, salesCancelFailedAt: new Date() }).catch((error: unknown) => {
        this.logger.error(`print order ${id}: could not record "${lastError}" (${errorMessage(error)})`);
      });
    }
  }

  // 와우프레스를 부르기 전에 막히는 줄부터 보고, 우리 쪽만 바꾸는 줄은 와우프레스 취소가 모두 끝난 뒤에 바꾼다
  private async gate(rows: PrintOrderRow[], run: Run): Promise<void> {
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
    const vendorRows = sorted.filter((r) => rank(r) === Rank.vendor);
    let prechecked = false;
    for (const row of sorted) {
      if (!prechecked && rank(row) === Rank.vendor) {
        prechecked = true;
        if (vendorRows.length > 1) await this.precheck(vendorRows, run);
      }
      this.raise(await this.cancelRow(row, run));
    }
  }

  private requestedQuantities(lines: PrintCancelLine[], mode: PrintCancelMode): Map<string, number> {
    const requested = new Map<string, number>();
    for (const line of lines) {
      if (mode === 'gate' && (!Number.isInteger(line.quantity) || line.quantity <= 0)) {
        throw new BadRequestError(`Partial cancellation quantity for line ${line.salesOrderLineId} must be positive`);
      }
      requested.set(line.salesOrderLineId, (requested.get(line.salesOrderLineId) ?? 0) + line.quantity);
    }
    return requested;
  }

  // gate 는 요청한 모든 줄(인쇄 아닌 줄 포함)을 와우프레스를 부르기 전에 검사한다. 뒤의 판매주문 검증에서 거절되면 인쇄만 멈춘다
  private async partialLineIds(
    salesOrderId: string,
    rows: PrintOrderRow[],
    requested: Map<string, number>,
    mode: PrintCancelMode,
  ): Promise<Set<string>> {
    const lineIds = mode === 'gate' ? [...requested.keys()] : rows.map((r) => r.salesOrderLineId);
    const quantities = await this.repository.lineQuantities(salesOrderId, lineIds);
    if (mode === 'gate') {
      for (const [lineId, asked] of requested) {
        const ordered = quantities.get(lineId);
        if (ordered === undefined) {
          throw new BadRequestError(`Sales order line ${lineId} does not belong to ${salesOrderId}`);
        }
        if (asked > ordered) throw new BadRequestError(cancelQuantityExceedsMessage(asked, ordered));
      }
    }
    const partial = new Set<string>();
    for (const row of rows) {
      const ordered = quantities.get(row.salesOrderLineId);
      const asked = requested.get(row.salesOrderLineId) ?? 0;
      // 인쇄가 이미 취소로 마무리된 줄은 와우프레스 주문을 쪼갤 일이 없어 남은 수량만 취소해도 된다
      if (ordered !== undefined && asked < ordered && !isOperatorResolved(row)) partial.add(row.id);
    }
    return partial;
  }

  // 와우프레스 주문이 둘 이상이면 하나라도 거절될 주문을 취소 전에 찾아, 일부만 취소된 채 멈추는 일을 줄인다
  private async precheck(rows: PrintOrderRow[], run: Run): Promise<void> {
    for (const row of rows) {
      const ordnum = row.vendorOrderNumber ?? '';
      const state = await this.detailState(row.id, ordnum);
      if (state === null) this.raise('unavailable');
      if (state === 'refused') {
        // 아직 아무 행도 선점하지 않았다. 고객 취소면 행을 그대로 두고 거절만 알린다
        if (run.keepOnRefusal) this.raise('refused');
        this.raise(await this.refuse(row, `wowpress order ${ordnum} is no longer cancellable`, run, 0));
      }
    }
  }

  private async cancelRow(row: PrintOrderRow, run: Run, depth = 0): Promise<Outcome> {
    if (depth > MAX_REREADS) {
      this.logger.error(`print order ${row.id} kept changing during ${run.mode} cancel; left as ${row.status}`);
      return 'busy';
    }
    // 두 번째 와우프레스 주문이 lastError 에만 남았을 수 있다. 하나만 취소하고 환불하지 않도록 운영자에게 넘긴다
    if (needsOperator(row)) {
      return this.refuse(row, row.lastError ?? '', run, depth);
    }
    switch (row.status) {
      case 'cancelled':
        return this.confirmCancelled(row, run, depth);
      case 'cancel_refused':
        return 'refused';
      case 'shipped':
      case 'delivered':
        if (run.mode === 'record') return this.flagShipped(row, run, depth);
        return 'shipped';
      case 'submitting':
        if (run.mode === 'gate') return 'busy';
        return this.refuse(row, 'cancelled on channel while submitting — verify on WowPress', run, depth);
      case 'cancelling':
        return this.resolveCancelling(row, run, depth);
    }
    if (row.vendorOrderNumber) {
      // 주문권처럼, cancelling 으로 먼저 바꾼 요청만 와우프레스 취소를 보낸다
      if (!(await this.repository.compareAndSet(row, { status: 'cancelling' }))) return this.reread(row, run, depth);
      return this.sendCancel({ ...row, status: 'cancelling' }, row.vendorOrderNumber, run, depth);
    }
    // 응답을 잃어 ordkey 조회를 기다리는 행이다. 운영자에게 넘기면 예정된 조회가 사라지므로 그대로 두고 다시 시도하게 한다
    if (run.mode === 'gate' && row.status === 'pending' && row.lastError === ORDER_LOOKUP_PENDING_ERROR) return 'busy';
    // 주문권을 썼는데 번호가 없으면 와우프레스에 주문이 들어갔는지 모르므로 자동으로 취소 처리하지 않는다
    if (row.orderAttemptedAt) return this.refuse(row, ORDER_UNCONFIRMED_ERROR, run, depth);
    if (
      !(await this.repository.compareAndSet(row, {
        status: 'cancelled',
        cancelResolvedAt: null,
        cancelResolvedBy: null,
      }))
    ) {
      return this.reread(row, run, depth);
    }
    run.result.locallyCancelled.push(row.id);
    return 'done';
  }

  // 앞선 시도의 결과를 모르는 행이다. 와우프레스 상태로 먼저 정하고, 취소 가능할 때만 오래된 표시를 빼앗아 다시 보낸다
  private async resolveCancelling(row: PrintOrderRow, run: Run, depth: number): Promise<Outcome> {
    const ordnum = row.vendorOrderNumber;
    if (!ordnum) return this.refuse(row, 'cancelling without wowpress ordnum', run, depth);
    const state = await this.detailState(row.id, ordnum);
    if (state === 'cancelled') return this.markCancelled(row, ordnum, run);
    if (state === 'refused') {
      return this.vendorRefused(row, `wowpress order ${ordnum} is no longer cancellable`, run, depth);
    }
    const stale = Date.now() - row.updatedAt.getTime() > CANCEL_CLAIM_STALE_MS;
    if (state === 'cancellable' && stale) {
      if (!(await this.repository.reclaimCancelling(row))) return this.reread(row, run, depth);
      return this.sendCancel(row, ordnum, run, depth);
    }
    if (run.mode === 'gate') return state === null ? 'unavailable' : 'busy';
    this.logger.warn(`print order ${row.id} is being cancelled elsewhere; left as cancelling`);
    return 'done';
  }

  private async sendCancel(claimed: PrintOrderRow, ordnum: string, run: Run, depth: number): Promise<Outcome> {
    try {
      await this.wowpress.cancel(ordnum);
    } catch (error) {
      const state =
        error instanceof WowpressApiError && !(error instanceof WowpressUnauthorizedError)
          ? await this.detailState(claimed.id, ordnum)
          : null;
      if (state === 'cancelled') return this.markCancelled(claimed, ordnum, run);
      if (state === 'refused') {
        return this.vendorRefused(claimed, `wowpress refused cancel: ${errorMessage(error)}`, run, depth);
      }
      // 결과를 모르므로 cancelling 으로 둔다. 다음 요청이 와우프레스 상태로 정한다
      this.logger.warn(`print order ${claimed.id} wowpress cancel failed (ordnum ${ordnum}): ${errorMessage(error)}`);
      if (run.mode === 'record') {
        return this.refuse(claimed, `wowpress cancel outcome unknown: ${errorMessage(error)}`, run, depth);
      }
      return 'unavailable';
    }
    this.logger.log(`print order ${claimed.id} cancelled at wowpress (ordnum ${ordnum})`);
    return this.markCancelled(claimed, ordnum, run);
  }

  private async markCancelled(row: PrintOrderRow, ordnum: string, run: Run): Promise<Outcome> {
    if (await this.repository.markVendorCancelled(row.id, ordnum)) {
      run.result.vendorCancelled.push(row.id);
      return 'done';
    }
    const fresh = await this.repository.findById(row.id);
    if (fresh?.vendorOrderNumber === ordnum && isPreservedLastError(fresh.lastError)) {
      // 아는 주문은 와우프레스에서 취소됐지만 그 사이 다른 주문의 증거가 기록됐다. 운영자에게 넘긴다
      this.logger.warn(`print order ${row.id}: wowpress ordnum ${ordnum} cancelled, but another order may exist`);
      return this.refuse(fresh, fresh.lastError ?? '', run, 0);
    }
    throw new Error(`print order ${row.id} lost ordnum ${ordnum} after wowpress cancel`);
  }

  private async detailState(id: string, ordnum: string): Promise<VendorState | null> {
    try {
      return vendorState(await this.wowpress.detail(ordnum));
    } catch (error) {
      this.logger.warn(`print order ${id} wowpress detail failed (ordnum ${ordnum}): ${errorMessage(error)}`);
      return null;
    }
  }

  // 와우프레스가 직접 취소를 거절했다. keepOnRefusal 이면 우리가 잡은 cancelling 표시만 풀어 원래대로 진행시킨다
  private async vendorRefused(row: PrintOrderRow, reason: string, run: Run, depth: number): Promise<Outcome> {
    if (!run.keepOnRefusal) return this.refuse(row, reason, run, depth);
    // 파일을 아직 못 보낸 주문은 제출 워커가 번호로 파일 전달부터 이어 가도록 대기열로 돌린다(운영자 생산 진행과 같은 판정)
    const status = row.trackingNumber ? 'shipped' : row.fileDeliveredAt ? 'submitted' : 'pending';
    const patch: Partial<PrintOrderRow> = status === 'pending' ? { status, nextAttemptAt: new Date() } : { status };
    // 기다리는 사이 중복 의심·번호 미저장 기록이 붙었으면 되돌리지 않는다. 다시 읽으면 운영자에게 넘어간다
    if (!(await this.repository.compareAndSetUnprotected(row, patch))) return this.reread(row, run, depth);
    this.logger.warn(`print order ${row.id} cancel refused (${run.mode}); kept as ${status}: ${reason}`);
    return 'refused';
  }

  private async refuse(row: PrintOrderRow, reason: string, run: Run, depth: number): Promise<Outcome> {
    const marked = await this.repository.compareAndSet(row, {
      status: 'cancel_refused',
      cancelRefusedAt: new Date(),
      lastError: reason,
    });
    if (!marked) return this.reread(row, run, depth);
    this.logger.warn(`print order ${row.id} cancel refused (${run.mode}): ${reason}`);
    return 'refused';
  }

  // 인쇄물은 이미 떠났는데 판매주문은 취소됐다. 상태·송장은 그대로 두고 운영자 확인 탭에 올린다
  private async flagShipped(row: PrintOrderRow, run: Run, depth: number): Promise<Outcome> {
    const marked = await this.repository.compareAndSet(row, {
      cancelRefusedAt: new Date(),
      cancelResolvedAt: null,
      cancelResolvedBy: null,
      lastError: SHIPPED_BEFORE_CANCEL_ERROR,
    });
    if (!marked) return this.reread(row, run, depth);
    this.logger.warn(`print order ${row.id} already ${row.status} but its sales order was cancelled`);
    return 'shipped';
  }

  private async record(row: PrintOrderRow, reason: string): Promise<Outcome> {
    const run: Run = { mode: 'record', result: { vendorCancelled: [], locallyCancelled: [] }, keepOnRefusal: false };
    // 일부 수량만 취소돼도 이미 떠난 인쇄물은 반품·환불을 운영자가 봐야 한다
    if ((row.status === 'shipped' || row.status === 'delivered') && !needsOperator(row)) {
      return this.flagShipped(row, run, 0);
    }
    if (TERMINAL_FOR_CANCEL.includes(row.status) && !needsOperator(row)) return 'done';
    return this.refuse(row, reason, run, 0);
  }

  // 처음 읽은 뒤 다른 주문의 증거가 붙었을 수 있다. 끝났다고 답하기 직전에 다시 읽어 판정한다
  private async confirmCancelled(row: PrintOrderRow, run: Run, depth: number): Promise<Outcome> {
    const fresh = await this.repository.findById(row.id);
    if (!fresh) return 'done';
    if (fresh.status === 'cancelled' && !needsOperator(fresh)) return 'done';
    return this.cancelRow(fresh, run, depth + 1);
  }

  private async reread(row: PrintOrderRow, run: Run, depth: number): Promise<Outcome> {
    const fresh = await this.repository.findById(row.id);
    if (!fresh) return 'done';
    return this.cancelRow(fresh, run, depth + 1);
  }

  private raise(outcome: Outcome): void {
    switch (outcome) {
      case 'done':
        return;
      case 'refused':
        throw new PrintInProductionError();
      case 'busy':
        throw new ConflictError(PRINT_CANCEL_RETRY_MESSAGE);
      case 'unavailable':
        throw new UpstreamUnavailableError(PRINT_CANCEL_RETRY_MESSAGE);
      case 'shipped':
        throw new PrintShippedError();
    }
  }
}
