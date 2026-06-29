import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx, carrierEnum } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { FulfillmentsService } from './fulfillments.service';

interface ShippingAddressJson {
  recipientName?: string;
  name?: string;
  phone?: string;
  roadAddress?: string;
  detailAddress?: string;
  address?: string;
}
import { DeliveryProvider, DeliveryRequest } from './delivery-provider.interface';
import { GoodsflowDeliveryProvider } from './goodsflow-delivery.provider';
import { HanjinDeliveryProvider } from './hanjin-delivery.provider';

export type InvoiceIssueMethod = 'goodsflow' | 'hanjin' | 'direct' | 'self';

/** 외부 배송 provider 를 경유하는 발행 방식 (direct/self 는 내부 발번) */
const PROVIDER_METHODS = ['goodsflow', 'hanjin'] as const;
type ProviderMethod = (typeof PROVIDER_METHODS)[number];

function isProviderMethod(method: string): method is ProviderMethod {
  return (PROVIDER_METHODS as readonly string[]).includes(method);
}

export interface IssueInvoiceRequest {
  fulfillmentOrderId: string;
  carrierCode: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  senderName?: string;
  senderPhone?: string;
  deliveryMessage?: string;
  issueMethod?: InvoiceIssueMethod;
  /**
   * direct(직접 입력) 발행 시 필수 — 택배사에서 실제 발급받은 운송장 번호.
   * 내부 발번(INV-*)이 고객 tracking 으로 나가는 것을 막는다. direct 외 방식에선 무시.
   */
  invoiceNumber?: string;
}

export interface InvoiceDetail {
  id: string;
  fulfillmentOrderId: string;
  invoiceNumber: string;
  carrierCode?: string;
  issueMethod: InvoiceIssueMethod;
  /** 외부 provider service id — 컬럼명은 goodsflow 시절 명명이지만 hanjin id 도 여기 저장 (기술부채) */
  goodsflowServiceId?: string;
  status: 'issued' | 'printed' | 'shipped' | 'canceled';
  issuedAt?: Date;
  printedAt?: Date;
  shippedAt?: Date;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  items: Array<{
    id: string;
    foiId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly deliveryProviders: Map<string, DeliveryProvider>;

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly fulfillmentsService: FulfillmentsService,
    goodsflowProvider: GoodsflowDeliveryProvider,
    private readonly hanjinProvider: HanjinDeliveryProvider,
  ) {
    this.deliveryProviders = new Map();
    this.deliveryProviders.set('goodsflow', goodsflowProvider);
    this.deliveryProviders.set('hanjin', hanjinProvider);
  }

  /**
   * 기본 발행 방식: 한진 env(계약 승인 후 secret)가 등록되면 자동으로 hanjin 이 기본이 된다.
   * 승인 전에는 기존 기본값(goodsflow)을 유지해 issueMethod 를 안 보내던 기존 호출이 깨지지 않게 한다.
   */
  private defaultIssueMethod(): InvoiceIssueMethod {
    return this.hanjinProvider.isConfigured() ? 'hanjin' : 'goodsflow';
  }

  private getProvider(method: ProviderMethod): DeliveryProvider {
    const provider = this.deliveryProviders.get(method);
    if (!provider) {
      throw new BadRequestException(`Delivery provider not configured: ${method}`);
    }
    return provider;
  }

  /**
   * 송장 발행 — 3단계 구조:
   *  1) 검증 + 라인 로드 (빠른 실패)
   *  2) 외부 provider 발급 — DB 트랜잭션 *밖* 에서 수행 (외부 네트워크 지연이 DB tx 를 점유하지 않게)
   *  3) 쓰기 트랜잭션 — FO row lock 후 재검증 + insert. 실패 시 외부 송장 보상 취소.
   *
   * 의도적으로 tx 인자를 받지 않는다 — provider 호출이 caller 트랜잭션 생명주기에 묶이면
   * phase 분리가 무력화된다. 트랜잭션 합성이 필요한 내부 재사용자는 DB 단계 헬퍼를 직접 쓸 것.
   * 동시 발행의 최종 방어선은 uq_invoices_fo_active partial unique index.
   */
  async issueInvoice(request: IssueInvoiceRequest, operatorId?: string): Promise<string> {
    const { fulfillmentOrderId } = request;
    const issueMethod = request.issueMethod ?? this.defaultIssueMethod();

    // direct = 택배사 발급 운송장을 운영자가 직접 입력하는 방식 — 번호 없이는 발행 불가.
    // (내부 발번이 필요하면 self 를 사용)
    if (issueMethod === 'direct' && !request.invoiceNumber?.trim()) {
      throw new BadRequestException('invoiceNumber is required for direct issuance (실제 운송장 번호 입력)');
    }

    // carrier 는 schema enum 에 있는 값만 허용 — unknown carrier 로 shipment 없이 발행되면
    // ship() 이 carrier='CJ', trackingNumber='' fallback 으로 outbox 에 나간다 (사고 경로 차단)
    const requestCarrier = carrierEnum.enumValues.find((v) => v === request.carrierCode);
    if (issueMethod !== 'hanjin' && !requestCarrier) {
      throw new BadRequestException(
        `Unsupported carrierCode '${request.carrierCode}'. Supported: ${carrierEnum.enumValues.join(', ')}`,
      );
    }

    // Phase 1: 검증 + 발급에 필요한 라인 로드
    const items = await this.dbService.run(async (trx) => {
      await this.assertIssuable(trx, fulfillmentOrderId);
      return this.loadInvoiceItems(trx, fulfillmentOrderId);
    });

    // Phase 2: 송장 번호 확보 (provider 방식은 외부 API 호출)
    let invoiceNumber: string;
    let externalServiceId: string | undefined;
    // hanjin 은 carrier 가 발행 방식에 의해 고정 — 요청값과 무관하게 HANJIN 으로 강제
    let carrierCode = issueMethod === 'hanjin' ? 'HANJIN' : request.carrierCode;

    if (isProviderMethod(issueMethod)) {
      const provider = this.getProvider(issueMethod);

      const deliveryRequest: DeliveryRequest = {
        centerCode: '',
        recipientName: request.recipientName,
        recipientAddress: request.recipientAddress,
        recipientPhone: request.recipientPhone,
        carrierCode,
        senderName: request.senderName,
        senderPhone: request.senderPhone,
        deliveryMessage: request.deliveryMessage,
        items,
      };

      const response = await provider.issueInvoice(deliveryRequest);
      invoiceNumber = response.invoiceNumber;
      externalServiceId = response.serviceId;
      carrierCode = response.carrierCode || carrierCode;
    } else if (issueMethod === 'direct') {
      invoiceNumber = request.invoiceNumber!.trim();
    } else {
      invoiceNumber = this.generateInvoiceNumber();
    }

    // Phase 3: 쓰기 트랜잭션 — lock 잡고 재검증 후 기록
    try {
      return await this.dbService.run(async (trx) => {
        await this.assertIssuable(trx, fulfillmentOrderId, { forUpdate: true });

        const [invoice] = await trx
          .insert(wmsTables.invoices)
          .values({
            fulfillmentOrderId,
            invoiceNumber,
            carrierCode,
            issueMethod,
            goodsflowServiceId: externalServiceId,
            status: 'issued',
            issuedAt: new Date(),
          })
          .returning();

        // 송장 발행 = 추적 가능한 shipment evidence 생성.
        // ship() 은 shipments 에서 tracking payload 를 읽으므로, 여기서 upsert 하지 않으면
        // FulfillmentShipped 가 carrier='CJ', trackingNumber='' 로 outbox 에 나간다.
        // 입력 carrier 는 위에서 검증됐고, provider 응답 carrier 가 unknown 이면 검증된 입력값으로 fallback.
        const carrier = carrierEnum.enumValues.find((v) => v === carrierCode) ?? requestCarrier ?? 'HANJIN';
        await trx
          .insert(wmsTables.shipments)
          .values({
            fulfillmentOrderId,
            trackingNo: invoiceNumber,
            carrier,
            status: 'created',
            openedBy: operatorId ?? null,
          })
          .onConflictDoUpdate({
            target: wmsTables.shipments.fulfillmentOrderId,
            set: {
              trackingNo: invoiceNumber,
              carrier,
              status: 'created',
              openedBy: operatorId ?? null,
              lastUpdated: new Date(),
            },
          });

        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'invoiced' })
          .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

        this.logger.log(`Issued invoice ${invoiceNumber} for FO ${fulfillmentOrderId} via ${issueMethod}`);
        return invoice.id;
      });
    } catch (error) {
      // 외부 송장은 이미 발급됐는데 내부 기록이 실패한 경우 — 보상 취소 (best-effort)
      if (externalServiceId && isProviderMethod(issueMethod)) {
        try {
          await this.getProvider(issueMethod).cancelInvoice(externalServiceId);
          this.logger.warn(
            `Compensated external invoice ${externalServiceId} (${issueMethod}) after DB write failure for FO ${fulfillmentOrderId}`,
          );
        } catch (cancelError) {
          // 보상 실패 — 외부 송장이 고아로 남음. 운영자 수동 취소 필요.
          this.logger.error(
            `ORPHANED external invoice ${externalServiceId} (${issueMethod}) for FO ${fulfillmentOrderId}: compensation cancel failed`,
            cancelError instanceof Error ? cancelError.stack : String(cancelError),
          );
        }
      }
      throw error;
    }
  }

  /** picked/inspected + 활성(미취소) invoice 없음 검증. forUpdate 로 쓰기 단계의 race 를 막는다. */
  private async assertIssuable(trx: DbTx, fulfillmentOrderId: string, opts: { forUpdate?: boolean } = {}) {
    const foQuery = trx
      .select({ id: wmsTables.fulfillmentOrders.id, status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
      .limit(1);
    const foRows = opts.forUpdate ? await foQuery.for('update') : await foQuery;
    const fulfillmentOrder = foRows[0];

    if (!fulfillmentOrder) {
      throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
    }

    // 검수는 선택 단계 — picked(검수 전) 또는 inspected(검수 완료) 둘 다 송장 발행 허용 (§4)
    if (fulfillmentOrder.status !== 'picked' && fulfillmentOrder.status !== 'inspected') {
      throw new ConflictException(`Cannot issue invoice for FO in status: ${fulfillmentOrder.status}`);
    }

    // canceled 는 중복으로 보지 않는다 — 취소 후 재발행 허용
    const existingRows = await trx
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(eq(wmsTables.invoices.fulfillmentOrderId, fulfillmentOrderId), ne(wmsTables.invoices.status, 'canceled')),
      )
      .limit(1);

    if (existingRows[0]) {
      throw new ConflictException(`Active invoice already exists for FO ${fulfillmentOrderId}`);
    }
  }

  /** DeliveryRequest.items 구성용 FOI + 단가 로드 */
  private async loadInvoiceItems(trx: DbTx, fulfillmentOrderId: string) {
    const foiRows = await trx
      .select({
        foiId: wmsTables.fulfillmentOrderItems.id,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        productName: wmsTables.skus.name,
        quantity: wmsTables.fulfillmentOrderItems.qty,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

    const salesOrderLineIds = foiRows.map((row) => row.salesOrderLineId).filter((id): id is string => id !== null);
    const salesOrderLines =
      salesOrderLineIds.length === 0
        ? []
        : await trx
            .select({ id: wmsTables.salesOrderLines.id, unitPrice: wmsTables.salesOrderLines.unitPrice })
            .from(wmsTables.salesOrderLines)
            .where(inArray(wmsTables.salesOrderLines.id, salesOrderLineIds));

    const priceMap = new Map(salesOrderLines.map((line) => [line.id, line.unitPrice]));

    return foiRows.map((row) => ({
      productName: row.productName ?? '',
      quantity: row.quantity,
      price: (row.salesOrderLineId && priceMap.get(row.salesOrderLineId)) || 0,
    }));
  }

  /** 출력 — 검증(읽기) → provider 호출(tx 밖) → printed 전이(쓰기 tx). provider 호출 때문에 tx 인자를 받지 않는다. */
  async printInvoices(invoiceIds: string[]): Promise<{ printUri?: string }> {
    const invoices = await this.dbService.run((trx) =>
      trx
        .select({
          id: wmsTables.invoices.id,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(inArray(wmsTables.invoices.id, invoiceIds)),
    );

    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('Some invoices not found');
    }

    // shipped/canceled 가 printed 로 회귀하는 것을 막는다. printed 재출력은 허용 (멱등).
    const notPrintable = invoices.filter((inv) => inv.status !== 'issued' && inv.status !== 'printed');
    if (notPrintable.length > 0) {
      throw new ConflictException(
        `Cannot print invoices not in issued/printed status: ${notPrintable
          .map((inv) => `${inv.id}(${inv.status})`)
          .join(', ')}`,
      );
    }

    // 부분 출력 금지: 요청된 invoice 전체가 동일 provider 발행이고 외부 service id 를 가져야 한다.
    // 일부만 출력되면 운영자는 "전부 출력됨" 으로 오인한다.
    const nonProvider = invoices.filter((inv) => !isProviderMethod(inv.issueMethod));
    if (nonProvider.length > 0) {
      throw new BadRequestException(
        `Cannot print direct/self invoices: ${nonProvider.map((inv) => inv.id).join(', ')}`,
      );
    }

    const missingServiceId = invoices.filter((inv) => !inv.goodsflowServiceId);
    if (missingServiceId.length > 0) {
      throw new BadRequestException(
        `Provider invoices missing external service id: ${missingServiceId.map((inv) => inv.id).join(', ')}`,
      );
    }

    const methods = new Set<ProviderMethod>();
    for (const inv of invoices) {
      if (isProviderMethod(inv.issueMethod)) methods.add(inv.issueMethod);
    }
    if (methods.size > 1) {
      throw new BadRequestException('Cannot print invoices from multiple delivery providers in one batch');
    }

    const [method] = methods;
    const provider = this.getProvider(method);

    const serviceIds = invoices.map((inv) => inv.goodsflowServiceId!);
    const printResponse = await provider.generatePrintUri(serviceIds);

    // provider 호출 동안의 동시 전이(shipped/canceled)를 덮어쓰지 않도록 조건부 update
    const updated = await this.dbService.run((trx) =>
      trx
        .update(wmsTables.invoices)
        .set({ status: 'printed', printedAt: new Date() })
        .where(
          and(
            inArray(
              wmsTables.invoices.id,
              invoices.map((inv) => inv.id),
            ),
            inArray(wmsTables.invoices.status, ['issued', 'printed']),
          ),
        )
        .returning({ id: wmsTables.invoices.id }),
    );

    if (updated.length !== invoices.length) {
      this.logger.warn(
        `printInvoices: ${invoices.length - updated.length}/${invoices.length} invoices transitioned during print and were not marked printed`,
      );
    }

    this.logger.log(`Generated print URI for ${invoices.length} invoices via ${method}`);
    return { printUri: printResponse.printUri };
  }

  async markAsShipped(invoiceId: string, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      const invoice = await trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          issueMethod: wmsTables.invoices.issueMethod,
          invoiceNumber: wmsTables.invoices.invoiceNumber,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      if (invoice.status === 'shipped') return;

      const isDirectOrSelf = invoice.issueMethod === 'direct' || invoice.issueMethod === 'self';
      const allowedStatuses = isDirectOrSelf ? ['issued', 'printed'] : ['printed'];
      if (!allowedStatuses.includes(invoice.status)) {
        throw new ConflictException(`Cannot ship invoice in status: ${invoice.status}`);
      }

      if (!invoice.invoiceNumber) {
        throw new BadRequestException('Cannot ship: invoiceNumber is required');
      }

      await trx
        .update(wmsTables.invoices)
        .set({ status: 'shipped', shippedAt: new Date() })
        .where(eq(wmsTables.invoices.id, invoiceId));

      // canonical ship path: FOI shippedQty, FO status='shipped', reservations, FulfillmentShipped event
      await this.fulfillmentsService.ship(invoice.fulfillmentOrderId, trx);

      this.logger.log(`Marked invoice ${invoiceId} as shipped`);
    }, tx);
  }

  /**
   * 취소 — 조회(읽기) → provider 취소(tx 밖) → 내부 취소(쓰기 tx).
   * provider 취소가 실패하면 내부 취소도 진행하지 않는다 — 외부 송장이 살아있는 채로
   * 재발행이 가능해지면(unique index 가 canceled 를 제외하므로) 한 FO 에 외부 송장 2개가 생긴다.
   * 운영자는 에러를 보고 재시도하거나 외부 송장을 수동 처리한 뒤 다시 취소한다.
   * provider 호출 때문에 tx 인자를 받지 않는다.
   */
  async cancelInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.dbService.run((trx) =>
      trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]),
    );

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === 'canceled') return;

    if (invoice.status === 'shipped') {
      throw new ConflictException('Cannot cancel shipped invoice');
    }

    if (isProviderMethod(invoice.issueMethod) && invoice.goodsflowServiceId) {
      const provider = this.getProvider(invoice.issueMethod);
      // 실패 시 그대로 전파 — 내부 취소 전이를 막는다
      await provider.cancelInvoice(invoice.goodsflowServiceId);
    }

    await this.dbService.run(async (trx) => {
      // provider 호출 동안 상태가 바뀌었을 수 있으므로 재검증 — shipped 전이됐다면 내부 취소 중단.
      // (외부는 이미 취소된 불일치 상태 — 운영자 수동 정리 필요하므로 에러 로그)
      const current = await trx
        .select({ status: wmsTables.invoices.status })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]);

      if (current?.status === 'shipped') {
        this.logger.error(
          `Invoice ${invoiceId} was shipped during external cancel — external invoice is canceled but internal is shipped. Manual review required.`,
        );
        throw new ConflictException('Invoice was shipped during cancellation');
      }

      await trx.update(wmsTables.invoices).set({ status: 'canceled' }).where(eq(wmsTables.invoices.id, invoiceId));

      // 발행 시 만든 shipment evidence 정리 — 아직 출고 전(created)인 경우에만.
      // 재발행 시에는 issueInvoice 의 upsert 가 새 운송장 번호로 덮어쓴다.
      await trx
        .delete(wmsTables.shipments)
        .where(
          and(
            eq(wmsTables.shipments.fulfillmentOrderId, invoice.fulfillmentOrderId),
            eq(wmsTables.shipments.status, 'created'),
          ),
        );

      // 검수 완료 후 발행된 송장이면 취소 시 inspected 로 복귀 — 검수 결과는 송장 취소로 무효화되지 않는다
      const completedInspections = await trx
        .select({ id: wmsTables.inspectionSessions.id })
        .from(wmsTables.inspectionSessions)
        .where(
          and(
            eq(wmsTables.inspectionSessions.fulfillmentOrderId, invoice.fulfillmentOrderId),
            eq(wmsTables.inspectionSessions.status, 'completed'),
          ),
        )
        .limit(1);
      const revertStatus = completedInspections[0] ? 'inspected' : 'picked';

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: revertStatus })
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.id, invoice.fulfillmentOrderId),
            // 발행이 만든 invoiced 상태만 되돌린다 — 다른 상태를 덮어쓰지 않게
            eq(wmsTables.fulfillmentOrders.status, 'invoiced'),
          ),
        );

      this.logger.log(`Canceled invoice ${invoiceId} (FO → ${revertStatus})`);
    });
  }

  async getInvoiceDetail(invoiceId: string, tx?: DbTx): Promise<InvoiceDetail> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.invoices.id,
          fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
          invoiceNumber: wmsTables.invoices.invoiceNumber,
          carrierCode: wmsTables.invoices.carrierCode,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
          status: wmsTables.invoices.status,
          issuedAt: wmsTables.invoices.issuedAt,
          printedAt: wmsTables.invoices.printedAt,
          shippedAt: wmsTables.invoices.shippedAt,
          foShippingAddress: wmsTables.fulfillmentOrders.shippingAddress,
        })
        .from(wmsTables.invoices)
        .leftJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.invoices.fulfillmentOrderId),
        )
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1);

      const invoice = rows[0];
      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      const foiRows = await trx
        .select({
          foiId: wmsTables.fulfillmentOrderItems.id,
          salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
          productName: wmsTables.skus.name,
          quantity: wmsTables.fulfillmentOrderItems.qty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.fulfillmentOrderItems.skuId))
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, invoice.fulfillmentOrderId));

      const salesOrderLineIds = foiRows.map((r) => r.salesOrderLineId).filter((id): id is string => id !== null);
      const priceMap =
        salesOrderLineIds.length === 0
          ? new Map<string, number>()
          : await trx
              .select({ id: wmsTables.salesOrderLines.id, unitPrice: wmsTables.salesOrderLines.unitPrice })
              .from(wmsTables.salesOrderLines)
              .where(inArray(wmsTables.salesOrderLines.id, salesOrderLineIds))
              .then((lines) => new Map(lines.map((l) => [l.id, l.unitPrice])));

      const addr = invoice.foShippingAddress as ShippingAddressJson | null;
      const recipientName = addr?.recipientName ?? addr?.name ?? undefined;
      const recipientAddress = addr
        ? [addr.roadAddress ?? addr.address, addr.detailAddress].filter(Boolean).join(' ') || undefined
        : undefined;
      const recipientPhone = addr?.phone ?? undefined;

      return {
        id: invoice.id,
        fulfillmentOrderId: invoice.fulfillmentOrderId,
        invoiceNumber: invoice.invoiceNumber,
        carrierCode: invoice.carrierCode ?? undefined,
        issueMethod: invoice.issueMethod,
        goodsflowServiceId: invoice.goodsflowServiceId ?? undefined,
        status: invoice.status,
        issuedAt: invoice.issuedAt ?? undefined,
        printedAt: invoice.printedAt ?? undefined,
        shippedAt: invoice.shippedAt ?? undefined,
        recipientName,
        recipientAddress,
        recipientPhone,
        items: foiRows.map((r) => ({
          id: r.foiId,
          foiId: r.foiId,
          productName: r.productName ?? '',
          quantity: r.quantity,
          unitPrice: (r.salesOrderLineId && priceMap.get(r.salesOrderLineId)) || 0,
        })),
      };
    }, tx);
  }

  /** 추적 — 조회만 DB, provider 호출은 tx 밖. provider 호출 때문에 tx 인자를 받지 않는다. */
  async trackInvoice(invoiceId: string) {
    const invoice = await this.dbService.run((trx) =>
      trx
        .select({
          id: wmsTables.invoices.id,
          issueMethod: wmsTables.invoices.issueMethod,
          goodsflowServiceId: wmsTables.invoices.goodsflowServiceId,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]),
    );

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (!isProviderMethod(invoice.issueMethod) || !invoice.goodsflowServiceId) {
      throw new BadRequestException('Tracking is only available for provider-issued invoices (goodsflow/hanjin)');
    }

    const provider = this.getProvider(invoice.issueMethod);

    return provider.trackDelivery(invoice.goodsflowServiceId);
  }

  private generateInvoiceNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `INV-${timestamp.slice(-8)}-${random}`;
  }
}
