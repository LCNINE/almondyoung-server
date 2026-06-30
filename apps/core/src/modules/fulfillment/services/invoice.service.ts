import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx, carrierEnum } from '../../inventory/schema/inventory.schema';
import { DbService } from '@app/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

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
  /** 외부 provider service id — 응답 필드명은 goodsflow 시절 명명 유지(컬럼은 externalServiceId) */
  goodsflowServiceId?: string;
  status: 'issued' | 'used' | 'voided';
  issuedAt?: Date;
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
   * 동시 발행의 최종 방어선은 assertIssuable 의 활성(미-void) invoice 재검증(FOR UPDATE).
   */
  async issueInvoice(request: IssueInvoiceRequest): Promise<string> {
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
            issuedForFulfillmentOrderId: fulfillmentOrderId,
            trackingNo: invoiceNumber,
            carrier: carrierEnum.enumValues.find((v) => v === carrierCode) ?? requestCarrier ?? null,
            issueMethod,
            externalServiceId,
            status: 'issued',
            issuedAt: new Date(),
          })
          .returning();

        // 박스(shipments) upsert 제거: 박스는 송장 발급이 아니라 송장 스캔(EU3 openBoxByScan)에서 lazy 생성.
        // issueInvoice 는 선발급-only. (RFC §Phase 2 #6.)

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

    // voided 는 중복으로 보지 않는다 — 취소 후 재발행 허용
    const existingRows = await trx
      .select({ id: wmsTables.invoices.id })
      .from(wmsTables.invoices)
      .where(
        and(
          eq(wmsTables.invoices.issuedForFulfillmentOrderId, fulfillmentOrderId),
          ne(wmsTables.invoices.status, 'voided'),
        ),
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

  /** 출력 — 검증(읽기) → provider 호출(tx 밖) → 외부 print URI 생성. status 전이 없음(멱등). provider 호출 때문에 tx 인자를 받지 않는다. */
  async printInvoices(invoiceIds: string[]): Promise<{ printUri?: string }> {
    const invoices = await this.dbService.run((trx) =>
      trx
        .select({
          id: wmsTables.invoices.id,
          issueMethod: wmsTables.invoices.issueMethod,
          externalServiceId: wmsTables.invoices.externalServiceId,
          status: wmsTables.invoices.status,
        })
        .from(wmsTables.invoices)
        .where(inArray(wmsTables.invoices.id, invoiceIds)),
    );

    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('Some invoices not found');
    }

    // 인쇄는 issued 상태에서만 (voided/used 회귀 방지). 인쇄는 외부 URI 생성만 하고 status 는 바꾸지 않는다 — 재출력 멱등.
    const notPrintable = invoices.filter((inv) => inv.status !== 'issued');
    if (notPrintable.length > 0) {
      throw new ConflictException(
        `Cannot print invoices not in issued status: ${notPrintable
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

    const missingServiceId = invoices.filter((inv) => !inv.externalServiceId);
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

    const serviceIds = invoices.map((inv) => inv.externalServiceId!);
    const printResponse = await provider.generatePrintUri(serviceIds);

    this.logger.log(`Generated print URI for ${invoices.length} invoices via ${method}`);
    return { printUri: printResponse.printUri };
  }

  /**
   * void 화 — 조회(읽기) → provider 취소(tx 밖) → 내부 void(쓰기 tx).
   * provider 취소가 실패하면 내부 void 도 진행하지 않는다 — 외부 송장이 살아있는 채로
   * 재발행이 가능해지면(unique index 가 voided 를 제외하므로) 한 박스에 외부 송장 2개가 생긴다.
   * 운영자는 에러를 보고 재시도하거나 외부 송장을 수동 처리한 뒤 다시 void 한다.
   * provider 호출 때문에 tx 인자를 받지 않는다.
   */
  async cancelInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.dbService.run((trx) =>
      trx
        .select({
          id: wmsTables.invoices.id,
          issuedForFulfillmentOrderId: wmsTables.invoices.issuedForFulfillmentOrderId,
          issueMethod: wmsTables.invoices.issueMethod,
          externalServiceId: wmsTables.invoices.externalServiceId,
          shipmentId: wmsTables.invoices.shipmentId,
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

    if (invoice.status === 'voided') return;

    // provider 외부취소 *전* 박스-shipped 선검사 — 이미 출고된 박스면 외부 운송장을 취소하지 않는다.
    // (외부 취소가 먼저 나간 뒤 내부 void 가 막히면 물리 소포가 취소된 운송장으로 이동하는 불일치가 생김)
    if (invoice.shipmentId) {
      const shipmentId = invoice.shipmentId;
      const preBox = await this.dbService.run((trx) =>
        trx
          .select({ status: wmsTables.shipments.status })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, shipmentId))
          .limit(1)
          .then((r) => r[0]),
      );
      if (preBox?.status === 'shipped') {
        throw new ConflictException('Cannot void invoice: box already shipped');
      }
    }

    if (isProviderMethod(invoice.issueMethod) && invoice.externalServiceId) {
      // 실패 시 그대로 전파 — 내부 void 전이를 막는다
      await this.getProvider(invoice.issueMethod).cancelInvoice(invoice.externalServiceId);
    }

    await this.dbService.run(async (trx) => {
      // 박스 재조회 — provider 호출 동안 shipped 로 전이됐을 수 있으므로 race backstop 으로 재검사.
      // 출고 전 박스면 canceled 로 정리, 그 사이 shipped 됐으면 void 중단(불일치는 운영자 수동 정리).
      const current = await trx
        .select({ status: wmsTables.invoices.status, shipmentId: wmsTables.invoices.shipmentId })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((r) => r[0]);

      if (current?.shipmentId) {
        const [box] = await trx
          .select({ status: wmsTables.shipments.status })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, current.shipmentId))
          .limit(1);
        if (box?.status === 'shipped') {
          throw new ConflictException('Cannot void invoice: box already shipped');
        }
        await trx
          .update(wmsTables.shipments)
          .set({ status: 'canceled', lastUpdated: new Date() })
          .where(eq(wmsTables.shipments.id, current.shipmentId));
      }

      await trx
        .update(wmsTables.invoices)
        .set({ status: 'voided', voidedAt: new Date() })
        .where(eq(wmsTables.invoices.id, invoiceId));

      // FO 되돌리기: 발행이 만든 'invoiced' 만 picked 로 복귀. inspection_sessions 조회(구 코드)는 제거 — 테이블 폐기됨.
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'picked' })
        .where(
          and(
            eq(wmsTables.fulfillmentOrders.id, invoice.issuedForFulfillmentOrderId),
            eq(wmsTables.fulfillmentOrders.status, 'invoiced'),
          ),
        );

      this.logger.log(`Voided invoice ${invoiceId}`);
    });
  }

  async getInvoiceDetail(invoiceId: string, tx?: DbTx): Promise<InvoiceDetail> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.invoices.id,
          issuedForFulfillmentOrderId: wmsTables.invoices.issuedForFulfillmentOrderId,
          trackingNo: wmsTables.invoices.trackingNo,
          carrier: wmsTables.invoices.carrier,
          issueMethod: wmsTables.invoices.issueMethod,
          externalServiceId: wmsTables.invoices.externalServiceId,
          status: wmsTables.invoices.status,
          issuedAt: wmsTables.invoices.issuedAt,
          foShippingAddress: wmsTables.fulfillmentOrders.shippingAddress,
        })
        .from(wmsTables.invoices)
        .leftJoin(
          wmsTables.fulfillmentOrders,
          eq(wmsTables.fulfillmentOrders.id, wmsTables.invoices.issuedForFulfillmentOrderId),
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
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, invoice.issuedForFulfillmentOrderId));

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

      // 응답 계약 필드명은 admin-web 호환을 위해 옛 이름을 유지한다 —
      // 컬럼 issuedForFulfillmentOrderId/trackingNo/carrier/externalServiceId 를
      // fulfillmentOrderId/invoiceNumber/carrierCode/goodsflowServiceId 로 매핑.
      return {
        id: invoice.id,
        fulfillmentOrderId: invoice.issuedForFulfillmentOrderId,
        invoiceNumber: invoice.trackingNo,
        carrierCode: invoice.carrier ?? undefined,
        issueMethod: invoice.issueMethod,
        goodsflowServiceId: invoice.externalServiceId ?? undefined,
        status: invoice.status,
        issuedAt: invoice.issuedAt ?? undefined,
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
          externalServiceId: wmsTables.invoices.externalServiceId,
        })
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.id, invoiceId))
        .limit(1)
        .then((rows) => rows[0]),
    );

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (!isProviderMethod(invoice.issueMethod) || !invoice.externalServiceId) {
      throw new BadRequestException('Tracking is only available for provider-issued invoices (goodsflow/hanjin)');
    }

    const provider = this.getProvider(invoice.issueMethod);

    return provider.trackDelivery(invoice.externalServiceId);
  }

  private generateInvoiceNumber(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `INV-${timestamp.slice(-8)}-${random}`;
  }
}
