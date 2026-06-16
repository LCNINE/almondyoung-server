import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { inboxEvents, wmsOrderMappings } from '../../schema';
import { eq, and, gt, inArray, sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { PimMedusaSyncService } from './pim-medusa-sync.service';
import { MembershipMedusaSyncService } from './membership-medusa-sync.service';
import { FirebaseMembershipSyncService } from './firebase-membership-sync.service';
import { MedusaClient } from './medusa.client';
import { AlmondAuthClient } from '../almond-auth/almond-auth.client';
import { EventChainService, generateMessageId } from '@app/events';
import type { PimActiveVersionChangedEvent, ChannelAdapterSchema } from '../../types';
import type {
  CategoryChangedPayload,
  ProductMasterDeletedPayload,
} from '@packages/event-contracts/streams/product.stream';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import type {
  Cafe24LinkedPayload,
  Cafe24UnlinkedPayload,
  UserEmailVerifiedPayload,
} from '@packages/event-contracts/streams/user.stream';

const PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES = ['ProductMasterActiveVersionChanged', 'ProductMasterDeleted'] as const;

const INBOX_WORKER_EVENT_TYPES = [
  'ProductMasterActiveVersionChanged',
  'ProductMasterDeleted',
  'CategoryChanged',
  'ProductSellableQuantityChanged',
  'MembershipStatusChanged',
  'UserEmailVerified',
  'Cafe24Linked',
  'Cafe24Unlinked',
  'FirebaseMembershipSynced',
  'CoreFulfillmentShipped',
  'CoreFulfillmentDelivered',
  'CoreOrderCancelled',
] as const;

type InboxWorkerEventType = (typeof INBOX_WORKER_EVENT_TYPES)[number];
type InboxEventRecord = Omit<typeof inboxEvents.$inferSelect, 'payload' | 'metadata'> & {
  payload: any;
  metadata: Record<string, any> | null;
};
type InboxWorkerEventRecord = Omit<InboxEventRecord, 'eventType'> & { eventType: InboxWorkerEventType };

function isProductMasterLifecycleEvent(
  eventType: string,
): eventType is (typeof PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES)[number] {
  return (PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

function isInboxWorkerEventType(eventType: string): eventType is InboxWorkerEventType {
  return (INBOX_WORKER_EVENT_TYPES as readonly string[]).includes(eventType);
}

@Injectable()
export class InboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboxWorkerService.name);
  private isRunning = false;
  private isStopping = false;
  private isClaiming = false;
  private inFlightHandlers = 0;
  private readonly inFlightEventIds = new Set<string>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly handlerStartIntervalMs: number;
  private readonly maxConcurrentHandlers: number;
  private readonly processingLeaseMs: number;
  private readonly shutdownDrainMs: number;
  private readonly maxRetries: number;

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly syncService: PimMedusaSyncService,
    private readonly membershipSyncService: MembershipMedusaSyncService,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
    private readonly medusaClient: MedusaClient,
    private readonly almondAuthClient: AlmondAuthClient,
    private readonly configService: ConfigService,
    private readonly eventChainService: EventChainService,
  ) {
    this.maxConcurrentHandlers = this.readPositiveIntConfig('INBOX_MAX_CONCURRENT_HANDLERS', 1);
    this.handlerStartIntervalMs = this.readPositiveIntConfig('INBOX_HANDLER_START_INTERVAL_MS', 10000);
    this.processingLeaseMs = this.readPositiveIntConfig('INBOX_PROCESSING_LEASE_MS', 15 * 60 * 1000);
    this.shutdownDrainMs = this.readNonNegativeIntConfig('INBOX_SHUTDOWN_DRAIN_MS', 25000);
    this.maxRetries = this.readPositiveIntConfig('INBOX_MAX_RETRIES', 5);
  }

  async onModuleInit() {
    this.logger.log('Starting Inbox Worker...');
    this.start();
  }

  start() {
    if (this.isRunning && !this.isStopping) {
      this.logger.warn('Inbox worker is already running');
      return;
    }

    this.isRunning = true;
    this.isStopping = false;
    void this.tryStartNextHandler();
    this.intervalId = setInterval(() => {
      void this.tryStartNextHandler();
    }, this.handlerStartIntervalMs);

    this.logger.log(
      `Inbox worker started (handlerStartIntervalMs=${this.handlerStartIntervalMs}ms, ` +
        `maxConcurrentHandlers=${this.maxConcurrentHandlers}, processingLeaseMs=${this.processingLeaseMs}ms, ` +
        `shutdownDrainMs=${this.shutdownDrainMs}ms, maxRetries=${this.maxRetries})`,
    );
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isStopping = true;
    this.isRunning = false;
    await this.drainInFlightHandlers();
    this.logger.log('Inbox worker stopped');
  }

  private readPositiveIntConfig(key: string, defaultValue: number): number {
    return this.readIntConfig(key, defaultValue, { min: 1 });
  }

  private readNonNegativeIntConfig(key: string, defaultValue: number): number {
    return this.readIntConfig(key, defaultValue, { min: 0 });
  }

  private readIntConfig(key: string, defaultValue: number, options: { min: number }): number {
    const raw = this.configService.get<string | number | undefined>(key);
    if (raw === undefined || raw === null || raw === '') {
      return defaultValue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value < options.min) {
      throw new Error(`Invalid ${key}: expected integer >= ${options.min}, received ${raw}`);
    }

    return value;
  }

  private async tryStartNextHandler(): Promise<void> {
    if (!this.isRunning || this.isStopping || this.isClaiming) {
      return;
    }

    if (this.inFlightHandlers >= this.maxConcurrentHandlers) {
      return;
    }

    this.isClaiming = true;
    try {
      const event = await this.claimNextInboxEvent();
      if (!event) {
        return;
      }

      this.inFlightHandlers += 1;
      this.inFlightEventIds.add(event.id);
      this.logger.debug(
        `Claimed inbox event: ${event.id} (type=${event.eventType}, attempts=${event.attempts}, ` +
          `inFlight=${this.inFlightHandlers}/${this.maxConcurrentHandlers})`,
      );
      void this.runClaimedEvent(event);
    } catch (error) {
      this.logger.error('Failed to claim inbox event', this.getErrorStack(error));
    } finally {
      this.isClaiming = false;
    }
  }

  private async claimNextInboxEvent(): Promise<InboxWorkerEventRecord | null> {
    const inFlightIds = [...this.inFlightEventIds];
    const excludeInFlightSql =
      inFlightIds.length > 0 ? sql`AND id <> ALL(${inFlightIds}::uuid[])` : sql.empty();

    const rows = await this.dbService.db.execute<InboxWorkerEventRecord>(sql`
      UPDATE ${inboxEvents}
      SET
        status = 'processing',
        attempts = attempts + 1,
        next_attempt_at = NOW() + (${this.processingLeaseMs} * interval '1 millisecond'),
        error_message = NULL
      WHERE id = (
        SELECT id
        FROM ${inboxEvents}
        WHERE event_type = ANY(${[...INBOX_WORKER_EVENT_TYPES]}::text[])
          AND (
            (status = 'pending' AND next_attempt_at <= NOW())
            OR (status = 'processing' AND next_attempt_at <= NOW())
          )
          ${excludeInFlightSql}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id,
        event_type AS "eventType",
        aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId",
        partition_key AS "partitionKey",
        payload,
        metadata,
        status,
        attempts,
        next_attempt_at AS "nextAttemptAt",
        error_message AS "errorMessage",
        event_occurred_at AS "eventOccurredAt",
        created_at AS "createdAt",
        published_at AS "publishedAt",
        failed_at AS "failedAt"
    `);

    return rows[0] ?? null;
  }

  private async runClaimedEvent(event: InboxWorkerEventRecord): Promise<void> {
    try {
      await this.processInboxEvent(event);
    } catch (error) {
      this.logger.error(`Unhandled inbox event processing error: ${event.id}`, this.getErrorStack(error));
    } finally {
      this.inFlightEventIds.delete(event.id);
      this.inFlightHandlers = Math.max(0, this.inFlightHandlers - 1);
    }
  }

  private async drainInFlightHandlers(): Promise<void> {
    if (this.inFlightHandlers === 0 || this.shutdownDrainMs === 0) {
      return;
    }

    const deadline = Date.now() + this.shutdownDrainMs;
    while (this.inFlightHandlers > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.inFlightHandlers > 0) {
      this.logger.warn(
        `Inbox worker shutdown drain timed out with ${this.inFlightHandlers} handler(s) still in flight`,
      );
    }
  }

  // 단일 inbox 이벤트 처리
  private async processInboxEvent(event: InboxWorkerEventRecord): Promise<void> {
    const chainId = event.metadata?.chainId ?? v7();
    const eventId = event.metadata?.messageId ?? generateMessageId();

    await this.eventChainService.runWithChain(chainId, eventId, () => this.doProcessInboxEvent(event));
  }

  private async doProcessInboxEvent(event: InboxEventRecord): Promise<void> {
    const eventId = event.id;
    const eventType = event.eventType;
    const aggregateId = event.aggregateId;
    const supersedingEventTypes = this.getSupersedingEventTypes(eventType);
    const supersedingStatuses = this.getSupersedingStatuses(eventType);

    try {
      this.logger.debug(`Processing inbox event: ${eventId} (type: ${eventType})`);
      const eventOccurredAt = this.resolveInboxEventOccurredAt(event);

      // aggregateId 기준 더 최신 lifecycle 이벤트가 있으면 현재 이벤트 스킵.
      // Product master delete는 늦게 도착한 이전 active-version retry보다 우선해야 한다.
      const [newerEvent] = await this.dbService.db
        .select({ id: inboxEvents.id })
        .from(inboxEvents)
        .where(
          and(
            eq(inboxEvents.aggregateId, aggregateId),
            inArray(inboxEvents.eventType, supersedingEventTypes),
            // drizzle 의 gt(raw sql, value) 는 좌변이 raw `sql` fragment 일 때 컬럼 타입 코덱을
            // 적용하지 못해, Date 객체를 직렬화하지 못한 채 드라이버로 넘겨 ERR_INVALID_ARG_TYPE
            // ("The string argument ... Received an instance of Date") 로 쿼리가 실패한다.
            // 우변을 ISO 문자열 + ::timestamptz 로 바인딩하고, 좌변(timestamp without tz)은
            // UTC instant 로 맞춰 정확히 비교한다.
            gt(
              sql`coalesce(${inboxEvents.eventOccurredAt}, ${inboxEvents.createdAt}) at time zone 'UTC'`,
              sql`${eventOccurredAt.toISOString()}::timestamptz`,
            ),
            inArray(inboxEvents.status, supersedingStatuses),
          ),
        )
        .limit(1);

      if (newerEvent) {
        // 더 최신 이벤트가 있으므로 현재 이벤트는 스킵
        await this.dbService.db
          .update(inboxEvents)
          .set({
            status: 'published',
            publishedAt: new Date(),
            errorMessage: `Superseded by newer event (aggregateId: ${aggregateId})`,
          })
          .where(eq(inboxEvents.id, eventId));

        this.logger.log(`Inbox event superseded: ${eventId} (newer event exists for ${aggregateId})`);
        return;
      }

      if (!isInboxWorkerEventType(eventType)) {
        throw new Error(`Unsupported inbox event type: ${eventType}`);
      }

      // Route based on event type
      switch (eventType) {
        case 'ProductMasterActiveVersionChanged':
          const productPayload: PimActiveVersionChangedEvent = event.payload;
          await this.syncService.handleActiveVersionChanged(productPayload);
          break;

        case 'ProductMasterDeleted':
          const deletedPayload: ProductMasterDeletedPayload = event.payload;
          await this.syncService.handleProductMasterDeleted(deletedPayload);
          break;

        case 'CategoryChanged':
          const categoryPayload: CategoryChangedPayload = event.payload;
          await this.syncService.handleCategoryChanged(categoryPayload);
          break;

        case 'ProductSellableQuantityChanged':
          const sellableQuantityPayload: ProductSellableQuantityChangedPayload = event.payload;
          await this.syncService.handleProductSellableQuantityChanged(sellableQuantityPayload);
          break;

        case 'MembershipStatusChanged':
          const membershipPayload: MembershipStatusChangedPayload = event.payload;
          await this.membershipSyncService.handleMembershipStatusChanged(membershipPayload);
          break;

        case 'UserEmailVerified': {
          const userPayload: UserEmailVerifiedPayload = event.payload;
          const customer = await this.medusaClient.findCustomerByAlmondUserId(userPayload.userId);
          if (!customer) {
            // Medusa customer는 첫 storefront 로그인 시 생성됨 → 이메일 인증 직후엔 없을 수 있음.
            // 에러를 throw해 inbox가 재시도하도록 한다 (maxRetries 초과 시 failed 상태로 남음).
            throw new Error(
              `[UserEmailVerified] No Medusa customer found for userId=${userPayload.userId}; will retry`,
            );
          }
          await this.medusaClient.issuePromotionsByTrigger(customer.id, 'customer_registered');
          break;
        }

        case 'Cafe24Linked': {
          const linkedPayload: Cafe24LinkedPayload = event.payload;
          const isActive = await this.almondAuthClient.getMembershipStatus(linkedPayload.cafe24MemberId);
          await this.firebaseMembershipSyncService.syncByFirebase(linkedPayload.cafe24MemberId, isActive);
          break;
        }

        case 'Cafe24Unlinked': {
          const unlinkedPayload: Cafe24UnlinkedPayload = event.payload;
          await this.firebaseMembershipSyncService.syncByFirebase(unlinkedPayload.cafe24MemberId, false);
          break;
        }

        case 'FirebaseMembershipSynced': {
          const syncedPayload: { cafe24MemberId: string; active: boolean } = event.payload;
          await this.firebaseMembershipSyncService.syncByFirebase(syncedPayload.cafe24MemberId, syncedPayload.active);
          break;
        }

        case 'CoreFulfillmentShipped': {
          // Core WMS에서 FO가 출고 완료됐을 때 Medusa order metadata를 shipped로 갱신.
          // payload.channelOrderId를 우선 사용하고 없으면 wms_order_mappings를 조회한다.
          // 둘 다 없으면 Medusa 채널 주문이 아닌 것이므로 스킵.
          const shippedPayload = event.payload as {
            fulfillmentId: string;
            orderId: string;
            channelOrderId?: string;
            trackingInfo?: { carrier?: string; trackingNumber?: string };
            shippedAt?: string;
          };

          let shippedMedusaOrderId = shippedPayload.channelOrderId ?? null;
          if (!shippedMedusaOrderId) {
            const [shippedMapping] = await this.dbService.db
              .select({ channelOrderId: wmsOrderMappings.channelOrderId })
              .from(wmsOrderMappings)
              .where(
                and(
                  eq(wmsOrderMappings.wmsOrderId, shippedPayload.orderId),
                  eq(wmsOrderMappings.salesChannel, 'medusa'),
                ),
              )
              .limit(1);
            shippedMedusaOrderId = shippedMapping?.channelOrderId ?? null;
          }

          if (!shippedMedusaOrderId) {
            this.logger.debug(`[CoreFulfillmentShipped] Medusa 매핑 없음, 스킵: orderId=${shippedPayload.orderId}`);
            break;
          }

          await this.medusaClient.updateOrderShippingProjection(shippedMedusaOrderId, {
            status: 'shipped',
            fulfillmentId: shippedPayload.fulfillmentId,
            carrier: shippedPayload.trackingInfo?.carrier,
            trackingNumber: shippedPayload.trackingInfo?.trackingNumber,
            shippedAt: shippedPayload.shippedAt,
          });
          this.logger.log(
            `[CoreFulfillmentShipped] Medusa 배송 시작 동기화 완료: orderId=${shippedPayload.orderId}, medusaOrderId=${shippedMedusaOrderId}`,
          );
          break;
        }

        case 'CoreFulfillmentDelivered': {
          // Core WMS에서 FO 배송 완료 시 Medusa order metadata를 delivered로 갱신.
          // payload.channelOrderId를 우선 사용하고 없으면 wms_order_mappings를 조회한다.
          const deliveredPayload = event.payload as {
            fulfillmentId: string;
            orderId: string;
            channelOrderId?: string;
            deliveredAt?: string;
          };

          let deliveredMedusaOrderId = deliveredPayload.channelOrderId ?? null;
          if (!deliveredMedusaOrderId) {
            const [deliveredMapping] = await this.dbService.db
              .select({ channelOrderId: wmsOrderMappings.channelOrderId })
              .from(wmsOrderMappings)
              .where(
                and(
                  eq(wmsOrderMappings.wmsOrderId, deliveredPayload.orderId),
                  eq(wmsOrderMappings.salesChannel, 'medusa'),
                ),
              )
              .limit(1);
            deliveredMedusaOrderId = deliveredMapping?.channelOrderId ?? null;
          }

          if (!deliveredMedusaOrderId) {
            this.logger.debug(`[CoreFulfillmentDelivered] Medusa 매핑 없음, 스킵: orderId=${deliveredPayload.orderId}`);
            break;
          }

          await this.medusaClient.updateOrderShippingProjection(deliveredMedusaOrderId, {
            status: 'delivered',
            fulfillmentId: deliveredPayload.fulfillmentId,
            deliveredAt: deliveredPayload.deliveredAt,
          });
          this.logger.log(
            `[CoreFulfillmentDelivered] Medusa 배송 완료 동기화 완료: orderId=${deliveredPayload.orderId}, medusaOrderId=${deliveredMedusaOrderId}`,
          );
          break;
        }

        case 'CoreOrderCancelled': {
          // Core(WMS)가 주문을 취소했을 때 Medusa order도 canceled로 동기화한다.
          // SalesOrderCancelledPayload.channelOrderId(Medusa order ID)로 wms_order_mappings를 조회.
          // channelOrderId가 없는 구 이벤트는 wmsOrderId fallback으로 조회(하위 호환).
          const cancelPayload: { orderId: string; channelOrderId?: string } = event.payload;

          const medusaOrderId = cancelPayload.channelOrderId ?? null;
          const [mapping] = await this.dbService.db
            .select({ channelOrderId: wmsOrderMappings.channelOrderId })
            .from(wmsOrderMappings)
            .where(
              and(
                medusaOrderId
                  ? eq(wmsOrderMappings.channelOrderId, medusaOrderId)
                  : eq(wmsOrderMappings.wmsOrderId, cancelPayload.orderId),
                eq(wmsOrderMappings.salesChannel, 'medusa'),
              ),
            )
            .limit(1);

          if (!mapping) {
            this.logger.debug(
              `[CoreOrderCancelled] Medusa 매핑 없음, 취소 동기화 스킵: orderId=${cancelPayload.orderId}, channelOrderId=${medusaOrderId}`,
            );
            break;
          }

          this.logger.log(
            `[CoreOrderCancelled] Medusa 주문 취소 동기화: coreOrderId=${cancelPayload.orderId}, medusaOrderId=${mapping.channelOrderId}`,
          );
          await this.medusaClient.cancelOrder(mapping.channelOrderId);
          break;
        }

        default:
          throw new Error(`Unsupported inbox event type: ${eventType}`);
      }

      // 성공 처리
      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
        })
        .where(eq(inboxEvents.id, eventId));

      this.logger.log(`Inbox event processed: ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to process inbox event: ${eventId}`, this.getErrorStack(error));

      // 실패 처리 (재시도 로직)
      await this.handleFailure(event, this.getErrorMessage(error));
    }
  }

  private getSupersedingEventTypes(eventType: string): string[] {
    if (isProductMasterLifecycleEvent(eventType)) {
      return [...PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES];
    }

    return [eventType];
  }

  private getSupersedingStatuses(eventType: string): string[] {
    if (isProductMasterLifecycleEvent(eventType)) {
      return ['pending', 'processing', 'published', 'failed'];
    }

    return ['pending', 'processing'];
  }

  private resolveInboxEventOccurredAt(event: any): Date {
    const value =
      event.eventOccurredAt ??
      event.metadata?.eventOccurredAt ??
      event.metadata?.occurredAt ??
      event.metadata?.timestamp ??
      event.payload?.changedAt ??
      event.payload?.deletedAt ??
      event.createdAt;
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid inbox event occurrence time: eventId=${event.id}, value=${value}`);
    }

    return date;
  }

  // 실패 처리: 재시도 횟수 증가 + 백오프 + DLQ
  private async handleFailure(event: InboxEventRecord, errorMessage: string): Promise<void> {
    const eventId = event.id;
    const attempts = Number.isInteger(event.attempts) && event.attempts > 0 ? event.attempts : 1;

    if (attempts >= this.maxRetries) {
      // 최대 재시도 횟수 초과 → failed (DLQ)
      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'failed',
          attempts,
          errorMessage,
          failedAt: new Date(),
        })
        .where(eq(inboxEvents.id, eventId));

      this.logger.error(`Inbox event failed permanently: ${eventId}`);
    } else {
      const nextAttemptAt = new Date(Date.now() + Math.pow(2, attempts) * 1000);

      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'pending',
          attempts,
          errorMessage,
          nextAttemptAt,
        })
        .where(eq(inboxEvents.id, eventId));

      this.logger.warn(
        `Inbox event retry scheduled: ${eventId} (attempts: ${attempts}, next: ${nextAttemptAt.toISOString()})`,
      );
    }
  }

  async onModuleDestroy() {
    await this.stop();
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private getErrorStack(error: unknown): string {
    return error instanceof Error ? error.stack || error.message : String(error);
  }
}
