import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { UgcAlmondDesignClient, type UgcPrintLink } from '../clients/ugc-almond-design.client';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { WowpressClient, WowpressDuplicateOrdersError } from '../wowpress/wowpress.client';
import { WOWPRESS_PRODUCTS } from '../wowpress/wowpress-products';
import { type WowpressLineSpec, type WowpressOrderResult } from '../wowpress/wowpress.types';
import {
  DUPLICATE_ORDER_ERROR_PREFIX,
  lateOrdnumError,
  PrintOrderRepository,
  UNSAVED_ORDNUM_ERROR_PREFIX,
  type PrintOrderLineContext,
} from './print-order.repository';

export const PRINT_ORDER_MAX_ATTEMPTS = 3;
// ponytail: 주문권(order_attempted_at)이 한 번뿐이라 멈춘 프로세스가 자동 재주문을 만들지는 못한다. 남는 건 응답을 잃은 행을 운영자가 와우프레스에서 확인하는 일이다
export const PRINT_ORDER_STALE_MS = 30 * 60_000;
export const ORDER_UNCONFIRMED_ERROR = 'order sent but not confirmed — verify on WowPress before retry';
export const ORDER_LOOKUP_PENDING_ERROR = 'order sent but response lost — looking up by ordkey before giving up';
export const ORDER_LOOKUP_DELAY_MS = 5 * 60_000;
export const DESIGN_OWNER_MISMATCH_ERROR = 'almond design does not belong to the ordering customer — not ordered';
export const DESIGN_SPEC_MISMATCH_ERROR = 'almond design does not match the purchased print product or size — not ordered';
const TEST_MEMO = '테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?';

const shippingAddress = z.object({
  recipientName: z.string(),
  phone: z.string(),
  postalCode: z.string(),
  roadAddress: z.string(),
  detailAddress: z.string().nullish(),
  deliveryNote: z.string().nullish(),
});

class LostOwnership extends Error {}
// 이미 failed 와 lastError 로 기록을 끝냈다는 신호. 이후 실패 처리를 하지 않는다
class AlreadyRecorded extends Error {}

function duplicateOrdersError(error: WowpressDuplicateOrdersError): string {
  return `${DUPLICATE_ORDER_ERROR_PREFIX}: ${error.ordnums.join(' / ')}`;
}

export function unsavedOrdnumError(ordnum: string): string {
  return `${UNSAVED_ORDNUM_ERROR_PREFIX}${ordnum} not saved — verify on WowPress`;
}

type OrdnumSource = 'order' | 'submit lookup' | 'stale lookup';

type Write = (patch: Partial<PrintOrderRow>) => Promise<boolean>;

interface Lane {
  row: PrintOrderRow;
  claimedAt: Date;
  write: Write;
  owned: (patch: Partial<PrintOrderRow>) => Promise<void>;
  state: { orderSent: boolean; ordnum: string | null };
}

interface ReadyLane extends Lane {
  ctx: PrintOrderLineContext;
  spec: WowpressLineSpec;
  link: UgcPrintLink;
  address: z.infer<typeof shippingAddress>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class PrintOrderSubmitManager {
  private readonly logger = new Logger(PrintOrderSubmitManager.name);

  constructor(
    private readonly repository: PrintOrderRepository,
    private readonly wowpress: WowpressClient,
    private readonly ugc: UgcAlmondDesignClient,
  ) {}

  async submit(row: PrintOrderRow): Promise<void> {
    const lane = this.lane(row);
    if (!lane) return;
    if (!lane.state.orderSent && !lane.state.ordnum) {
      await this.orderNew([lane]);
      return;
    }
    try {
      // 파일까지 보냈는데 submitted 로 바꾸기 전에 멈춘 행이다. 업로드는 되풀이하지 않는다
      if (lane.state.ordnum && row.fileDeliveredAt) {
        await lane.owned({ status: 'submitted', submittingAt: null });
        return;
      }
      const line = await this.lineSpec(lane);
      if (!line) return;
      const ordnum = lane.state.ordnum ?? (await this.confirmSentOrder(row));
      lane.state.ordnum = ordnum;
      const link = await this.ugc.printLink(row.almondDesignId, line.spec.file.format, line.spec.file.dpi);
      await this.deliver(lane, ordnum, link);
    } catch (error) {
      await this.settle(lane, error);
    }
  }

  async submitBatch(rows: PrintOrderRow[]): Promise<void> {
    const fresh: Lane[] = [];
    for (const row of rows) {
      if (row.orderAttemptedAt !== null || row.vendorOrderNumber !== null) {
        await this.submit(row);
        continue;
      }
      const lane = this.lane(row);
      if (lane) fresh.push(lane);
    }
    if (fresh.length > 0) await this.orderNew(fresh);
  }

  private lane(row: PrintOrderRow): Lane | null {
    if (row.status !== 'submitting' || !row.submittingAt) {
      this.logger.warn(`print order ${row.id} is not a claimed row (status ${row.status})`);
      return null;
    }
    // 선점 시각이 소유권 표식이다. 다른 인스턴스가 다시 집으면 이 값이 바뀌어 이후 쓰기가 0행이 된다
    const claimedAt = row.submittingAt;
    const write: Write = (patch) => this.repository.updateOwned(row.id, claimedAt, patch);
    const owned = async (patch: Partial<PrintOrderRow>) => {
      if (!(await write(patch))) throw new LostOwnership();
    };
    return {
      row,
      claimedAt,
      write,
      owned,
      state: { orderSent: row.orderAttemptedAt !== null, ordnum: row.vendorOrderNumber },
    };
  }

  private async lineSpec(lane: Lane): Promise<{ ctx: PrintOrderLineContext; spec: WowpressLineSpec } | null> {
    const ctx = await this.repository.findLineContext(lane.row.salesOrderLineId);
    if (!ctx) throw new Error(`sales order line not found: ${lane.row.salesOrderLineId}`);

    const spec = WOWPRESS_PRODUCTS[ctx.line.variantId];
    if (!spec) {
      await lane.owned({ status: 'unsupported', lastError: `no wowpress spec for variant ${ctx.line.variantId}` });
      return null;
    }

    return { ctx, spec };
  }

  private async prepare(lane: Lane): Promise<ReadyLane | null> {
    const line = await this.lineSpec(lane);
    if (!line) return null;

    const { ctx, spec } = line;
    // 시안 ID 는 고객이 장바구니 메타데이터로 넣는 값이다. 남의 시안을 인쇄해 받지 못하게 주문 고객과 대조한다
    const design = await this.ugc.design(lane.row.almondDesignId);
    if (design.userId !== ctx.order.customerId) {
      await lane.owned({ status: 'failed', lastError: DESIGN_OWNER_MISMATCH_ERROR });
      return null;
    }
    if (
      design.productId !== spec.design.productId ||
      design.widthMm !== spec.design.widthMm ||
      design.heightMm !== spec.design.heightMm
    ) {
      await lane.owned({ status: 'failed', lastError: DESIGN_SPEC_MISMATCH_ERROR });
      return null;
    }

    // 파일을 못 만들면 주문하지 않도록 링크를 주문보다 먼저 받는다
    const link = await this.ugc.printLink(lane.row.almondDesignId, spec.file.format, spec.file.dpi);
    const address = shippingAddress.parse(ctx.order.shippingAddress);
    await this.wowpress.quote(spec, ctx.line.quantity);

    return { ...lane, ctx, spec, link, address };
  }

  private async orderNew(lanes: Lane[]): Promise<void> {
    const prepared = await Promise.all(
      lanes.map(async (lane) => {
        try {
          return await this.prepare(lane);
        } catch (error) {
          await this.settle(lane, error);
          return null;
        }
      }),
    );
    const ready = prepared.filter((lane): lane is ReadyLane => lane !== null);

    const sent: ReadyLane[] = [];
    for (const lane of ready) {
      try {
        // 주문권은 행마다 한 번뿐이다. 이 UPDATE 가 1행일 때만 주문을 보낸다
        if (!(await this.repository.takeOrderRight(lane.row.id, lane.claimedAt, { testMemo: !lane.spec.confirmed }))) {
          throw new LostOwnership();
        }
        lane.state.orderSent = true;
        sent.push(lane);
      } catch (error) {
        await this.settle(lane, error);
      }
    }

    const [first] = sent;
    if (!first) return;

    let result: WowpressOrderResult;
    try {
      result = await this.wowpress.order({
        items: sent.map((lane) => ({
          spec: lane.spec,
          qty: lane.ctx.line.quantity,
          ordbody: lane.spec.confirmed ? '' : TEST_MEMO,
          ordkey: lane.ctx.line.id,
        })),
        ordtitle: `아몬드영 ${first.ctx.order.channelOrderId}`,
        receiver: {
          name: first.address.recipientName,
          tel: first.address.phone,
          zipcode: first.address.postalCode,
          addr1: first.address.roadAddress,
          addr2: first.address.detailAddress ?? '',
          dlvymsg: first.address.deliveryNote ?? '',
        },
      });
    } catch (error) {
      for (const lane of sent) await this.settle(lane, error);
      return;
    }

    for (const lane of sent) {
      try {
        await this.finishOrdered(lane, result, sent.length === 1);
      } catch (error) {
        await this.settle(lane, error);
      }
    }
  }

  private async finishOrdered(lane: ReadyLane, result: WowpressOrderResult, single: boolean): Promise<void> {
    const { ordnum, dboxnum, source } = await this.matchOrdnum(lane.row, result, single);
    if (!(await this.recordReceivedOrdnum(lane.row, ordnum, source))) throw new AlreadyRecorded();
    lane.state.ordnum = ordnum;
    await this.saveBox(lane.row, result, ordnum, dboxnum);
    await this.deliver(lane, ordnum, lane.link);
  }

  private async matchOrdnum(
    row: PrintOrderRow,
    result: WowpressOrderResult,
    single: boolean,
  ): Promise<{ ordnum: string; dboxnum: string | null; source: OrdnumSource }> {
    const [placed] = result.orders;
    if (single && placed) return { ordnum: placed.ordnum, dboxnum: null, source: 'order' };
    const found = await this.wowpress.findByOrdkey(row.salesOrderLineId, row.createdAt);
    if (!found) throw new Error(`ordkey ${row.salesOrderLineId} not found on wowpress`);
    return { ...found, source: 'submit lookup' };
  }

  private async saveBox(
    row: PrintOrderRow,
    result: WowpressOrderResult,
    ordnum: string,
    listedBoxNumber: string | null,
  ): Promise<void> {
    const placed = result.orders.find((o) => o.ordnum === ordnum);
    const box = placed ? result.boxes.find((b) => b.dboxno === placed.dboxno) : undefined;

    await this.storeBox(row, ordnum, {
      vendorBoxNumber: box?.dboxnum ?? listedBoxNumber,
      vendorShippingFee: box?.shippingFee ?? null,
    });
  }

  private async storeBox(
    row: PrintOrderRow,
    ordnum: string,
    box: { vendorBoxNumber: string | null; vendorShippingFee: number | null },
  ): Promise<void> {
    try {
      await this.repository.saveVendorBox(row.id, box);
    } catch (error) {
      this.logger.warn(`print order ${row.id} ordnum ${ordnum}: could not save vendor box (${errorMessage(error)})`);
    }
  }

  private async deliver(lane: Lane, ordnum: string, link: UgcPrintLink): Promise<void> {
    // 링크·주문 응답을 기다리는 사이 취소 흐름이 행을 가져갔으면 올리지 않는다. 업로드는 제작을 풀어 되돌릴 수 없다
    await lane.owned({ updatedAt: new Date() });
    await this.wowpress.uploadFileUrl(ordnum, link.fileName, link.url);
    // 그사이 취소 흐름이 행을 가져갔어도 파일은 이미 갔다. 소유 조건 없이 남겨야 운영자 마무리가 다시 올리지 않는다
    await this.repository.update(lane.row.id, { fileDeliveredAt: new Date() });
    await lane.owned({ status: 'submitted', submittingAt: null });
  }

  private async settle(lane: Lane, error: unknown): Promise<void> {
    // 한 줄의 실패 기록이 던져도 같은 묶음의 다른 줄 처리는 이어 간다
    try {
      await this.recordLineFailure(lane, error);
    } catch (recordError) {
      this.logger.error(
        `print order ${lane.row.id}: could not record failure "${errorMessage(error)}" (${errorMessage(recordError)})`,
      );
    }
  }

  private async recordLineFailure(lane: Lane, error: unknown): Promise<void> {
    const { row, state, write } = lane;
    if (error instanceof LostOwnership) {
      this.logger.warn(`print order ${row.id} was reclaimed or its order right is taken; stopped`);
      return;
    }
    if (error instanceof AlreadyRecorded) return;
    if (error instanceof WowpressDuplicateOrdersError) {
      await this.recordTerminal(row, duplicateOrdersError(error));
      return;
    }
    if (state.orderSent && !state.ordnum) {
      // 이번 차례에 보낸 주문의 응답만 잃었을 수 있다. 바로 포기하지 않고 한 번 미뤄, 다음 차례의 ordkey 조회
      // (confirmSentOrder)가 주문을 찾으면 파일 전달부터 이어 가게 한다. 다음 차례 조회에서도 못 찾으면 운영자 확인으로 넘긴다
      if (row.orderAttemptedAt === null) {
        await this.deferLookup(row.id, error, write);
        return;
      }
      await this.markUnconfirmed(row.id, error, write);
      return;
    }
    await this.fail(row, error, write);
  }

  async recoverStale(row: PrintOrderRow): Promise<void> {
    const olderThan = new Date(Date.now() - PRINT_ORDER_STALE_MS);
    const write: Write = (patch) => this.repository.updateStale(row.id, olderThan, patch);
    try {
      if (!row.vendorOrderNumber && row.orderAttemptedAt) {
        const found = await this.wowpress.findByOrdkey(row.salesOrderLineId, row.createdAt).catch((error: unknown) => {
          if (error instanceof WowpressDuplicateOrdersError) throw error;
          this.logger.warn(`print order ${row.id} ordkey lookup failed: ${errorMessage(error)}`);
          return null;
        });
        if (!found) {
          await this.markUnconfirmed(row.id, new Error('ordkey not found during stale recovery'), write);
          return;
        }
        // 저장하지 못한 행은 recordReceivedOrdnum 이 failed 로 넘겼다. 파일을 보내지 않는다
        if (!(await this.recordReceivedOrdnum(row, found.ordnum, 'stale lookup'))) return;
        await this.storeBox(row, found.ordnum, { vendorBoxNumber: found.dboxnum, vendorShippingFee: null });
      }
      if (!(await write({ status: 'pending', nextAttemptAt: new Date() }))) {
        this.logger.warn(`print order ${row.id} is no longer stale; left as is`);
      }
    } catch (error) {
      if (error instanceof WowpressDuplicateOrdersError) {
        await this.recordTerminal(row, duplicateOrdersError(error));
        return;
      }
      // 주문권을 쓴 행은 예외가 나도 pending 으로 돌리지 않는다
      if (row.orderAttemptedAt) {
        await this.failSentStale(row, error, write);
        return;
      }
      await this.fail(row, error, write);
    }
  }

  private async failSentStale(row: PrintOrderRow, cause: unknown, write: Write): Promise<void> {
    const lastError = row.vendorOrderNumber ? errorMessage(cause) : ORDER_UNCONFIRMED_ERROR;
    this.logger.error(
      `print order ${row.id} line ${row.salesOrderLineId} stale recovery failed (ordnum ${row.vendorOrderNumber ?? 'none'}): ${errorMessage(cause)}`,
    );
    const recorded = await write({ status: 'failed', lastError }).catch((error: unknown) => {
      this.logger.error(`print order ${row.id}: could not mark failed (${errorMessage(error)})`);
      return true;
    });
    if (!recorded) this.logger.warn(`print order ${row.id} is no longer stale; left as is`);
  }

  // 주문권을 이미 썼는데 번호가 없으면 다시 주문하지 않고 ordkey 로만 확인한다
  private async confirmSentOrder(row: PrintOrderRow): Promise<string> {
    const found = await this.wowpress.findByOrdkey(row.salesOrderLineId, row.createdAt);
    if (!found) throw new Error(`ordkey ${row.salesOrderLineId} not found on wowpress`);
    if (!(await this.recordReceivedOrdnum(row, found.ordnum, 'submit lookup'))) throw new AlreadyRecorded();
    await this.storeBox(row, found.ordnum, { vendorBoxNumber: found.dboxnum, vendorShippingFee: null });
    return found.ordnum;
  }

  private async deferLookup(id: string, cause: unknown, write: Write): Promise<void> {
    this.logger.warn(`print order ${id}: ${ORDER_LOOKUP_PENDING_ERROR} (${errorMessage(cause)})`);
    const patch: Partial<PrintOrderRow> = {
      status: 'pending',
      nextAttemptAt: new Date(Date.now() + ORDER_LOOKUP_DELAY_MS),
      lastError: ORDER_LOOKUP_PENDING_ERROR,
    };
    if (!(await write(patch))) this.logger.warn(`print order ${id} was reclaimed; lookup not deferred here`);
  }

  private async markUnconfirmed(id: string, cause: unknown, write: Write): Promise<void> {
    this.logger.error(`print order ${id}: ${ORDER_UNCONFIRMED_ERROR} (${errorMessage(cause)})`);
    if (!(await write({ status: 'failed', lastError: ORDER_UNCONFIRMED_ERROR }))) {
      this.logger.warn(`print order ${id} was reclaimed; unconfirmed order not recorded here`);
    }
  }

  // 와우프레스에서 받은 번호(주문 응답·ordkey 조회)는 모두 여기로 저장한다. false 면 failed 로 넘겼으니 호출자는 멈춘다
  private async recordReceivedOrdnum(row: PrintOrderRow, ordnum: string, source: OrdnumSource): Promise<boolean> {
    // 저장이 실패해도 번호가 남도록 DB 쓰기 전에 로그부터 남긴다
    this.logger.log(
      `print order ${row.id} line ${row.salesOrderLineId} received wowpress ordnum ${ordnum} (${source})`,
    );
    let stored: string | null;
    try {
      // 소유권을 잃었어도 받은 번호는 남겨야 하므로 소유 조건 없이 쓴다
      stored = (await this.repository.saveVendorOrderNumber(row.id, ordnum))
        ? ordnum
        : await this.repository.findVendorOrderNumber(row.id);
    } catch (error) {
      await this.recordTerminal(row, unsavedOrdnumError(ordnum), error);
      return false;
    }
    if (stored !== ordnum) {
      await this.recordTerminal(row, `${DUPLICATE_ORDER_ERROR_PREFIX}: ${stored ?? ''} / ${ordnum}`);
      return false;
    }
    return !(await this.flagIfCancelled(row, ordnum));
  }

  // 응답을 기다리는 사이 취소 흐름이 행을 가져갔으면 살아 있는 와우프레스 주문이다. 파일을 보내지 않고 운영자에게 넘긴다
  private async flagIfCancelled(row: PrintOrderRow, ordnum: string): Promise<boolean> {
    try {
      if (!(await this.repository.flagLateOrdnum(row.id, ordnum))) return false;
    } catch (error) {
      await this.recordTerminal(row, lateOrdnumError(ordnum), error);
      return true;
    }
    this.logger.error(`print order ${row.id} line ${row.salesOrderLineId}: ${lateOrdnumError(ordnum)}`);
    return true;
  }

  private async recordTerminal(row: PrintOrderRow, lastError: string, cause?: unknown): Promise<void> {
    const at = `print order ${row.id} line ${row.salesOrderLineId}`;
    this.logger.error(`${at}: ${lastError}${cause === undefined ? '' : ` (${errorMessage(cause)})`}`);
    await this.repository.recordFailure(row.id, lastError).catch((error: unknown) => {
      this.logger.error(`${at}: could not record "${lastError}" (${errorMessage(error)})`);
    });
  }

  private async fail(row: PrintOrderRow, error: unknown, write: Write): Promise<void> {
    const attemptCount = row.attemptCount + 1;
    const lastError = errorMessage(error);
    this.logger.warn(`print order ${row.id} attempt ${attemptCount} failed: ${lastError}`);
    const patch: Partial<PrintOrderRow> =
      attemptCount >= PRINT_ORDER_MAX_ATTEMPTS
        ? { status: 'failed', attemptCount, lastError }
        : {
            status: 'pending',
            attemptCount,
            lastError,
            nextAttemptAt: new Date(Date.now() + 2 ** attemptCount * 60_000),
          };
    if (!(await write(patch))) this.logger.warn(`print order ${row.id} was reclaimed; failure not recorded`);
  }
}
