import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { inboxEvents, wmsOrderMappings } from '../../schema';
import { ORDER_STREAM_EVENT_TYPES } from '../../order-event-routing';
import { eq, and, lte, notInArray, gt, inArray, sql } from 'drizzle-orm';
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

function isProductMasterLifecycleEvent(
  eventType: string,
): eventType is (typeof PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES)[number] {
  return (PRODUCT_MASTER_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

@Injectable()
export class InboxWorkerService implements OnModuleInit {
  private readonly logger = new Logger(InboxWorkerService.name);
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
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
    this.pollIntervalMs =
      this.configService.get<number>('INBOX_POLL_INTERVAL_MS') ||
      this.configService.get<number>('OUTBOX_POLL_INTERVAL_MS') ||
      5000; // 5초마다 polling (backward compatibility)
    this.batchSize =
      this.configService.get<number>('INBOX_BATCH_SIZE') || this.configService.get<number>('OUTBOX_BATCH_SIZE') || 10;
    this.maxRetries =
      this.configService.get<number>('INBOX_MAX_RETRIES') || this.configService.get<number>('OUTBOX_MAX_RETRIES') || 5;
  }

  async onModuleInit() {
    this.logger.log('Starting Inbox Worker...');
    this.start();
  }

  start() {
    if (this.isRunning) {
      this.logger.warn('Inbox worker is already running');
      return;
    }

    this.isRunning = true;
    this.intervalId = setInterval(async () => {
      await this.processInboxBatch();
    }, this.pollIntervalMs);

    this.logger.log(`Inbox worker started (poll interval: ${this.pollIntervalMs}ms)`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.logger.log('Inbox worker stopped');
  }

  // Inbox에서 pending 이벤트를 가져와 처리
  private async processInboxBatch(): Promise<void> {
    try {
      // 1. pending 상태이면서 nextAttemptAt이 지난 이벤트 조회
      // Order events are handled by OutboxDispatcherService which publishes them to Kafka.
      // Exclude them here to avoid marking them as published before they reach Kafka — this
      // worker has no switch case for them and would otherwise route them to the `default`
      // branch and mark them published before dispatch. The exclusion list is shared with the
      // dispatcher via ORDER_STREAM_EVENT_TYPES so the two can never drift.
      const events = await this.dbService.db
        .select()
        .from(inboxEvents)
        .where(
          and(
            eq(inboxEvents.status, 'pending'),
            lte(inboxEvents.nextAttemptAt, new Date()),
            notInArray(inboxEvents.eventType, [...ORDER_STREAM_EVENT_TYPES]),
          ),
        )
        .orderBy(inboxEvents.createdAt)
        .limit(this.batchSize);

      if (events.length === 0) {
        return;
      }

      this.logger.debug(`Processing ${events.length} inbox events...`);

      for (const event of events) {
        await this.processInboxEvent(event);
      }
    } catch (error) {
      this.logger.error('Failed to process inbox batch', error.stack);
    }
  }

  // 단일 inbox 이벤트 처리
  private async processInboxEvent(event: any): Promise<void> {
    const chainId = event.metadata?.chainId ?? v7();
    const eventId = event.metadata?.messageId ?? generateMessageId();

    await this.eventChainService.runWithChain(chainId, eventId, () => this.doProcessInboxEvent(event));
  }

  private async doProcessInboxEvent(event: any): Promise<void> {
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
            // event_occurred_at/created_at 은 `timestamp without time zone` 이라 PG 는 비교 파라미터를
            // timestamp 로 추론하지만, postgres.js 는 JS Date 를 timestamptz binary 로 전송한다.
            // 타입/바이너리 불일치로 prepared query 가 실패하므로, 컬럼을 UTC 기준 timestamptz 로 맞춰 비교한다.
            gt(
              sql<Date>`coalesce(${inboxEvents.eventOccurredAt}, ${inboxEvents.createdAt}) at time zone 'UTC'`,
              eventOccurredAt,
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

      // 상태를 processing으로 변경 (동시 처리 방지)
      await this.dbService.db.update(inboxEvents).set({ status: 'processing' }).where(eq(inboxEvents.id, eventId));

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
          this.logger.warn(`Unknown event type: ${eventType} for event ${eventId}`);
          break;
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
      this.logger.error(`Failed to process inbox event: ${eventId}`, error.stack);

      // 실패 처리 (재시도 로직)
      await this.handleFailure(event, error.message);
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
  private async handleFailure(event: any, errorMessage: string): Promise<void> {
    const eventId = event.id;
    const attempts = event.attempts + 1;

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
    this.stop();
  }
}
