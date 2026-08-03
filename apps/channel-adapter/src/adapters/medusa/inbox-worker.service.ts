import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { channelDispatchOperations, inboxEvents, wmsOrderMappings } from '../../schema';
import { eq, ne, and, gt, inArray, sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { PimMedusaSyncService } from './pim-medusa-sync.service';
import { MembershipMedusaSyncService } from './membership-medusa-sync.service';
import { FirebaseMembershipSyncService } from './firebase-membership-sync.service';
import { MedusaClient } from './medusa.client';
import { AlmondAuthClient } from '../almond-auth/almond-auth.client';
import { MembershipServiceClient } from '../../services/membership-service.client';
import { EventChainService, generateMessageId } from '@app/events';
import type { PimActiveVersionChangedEvent, ChannelAdapterSchema } from '../../types';
import type {
  CategoryChangedPayload,
  ProductMasterDeletedPayload,
  ProductPublishOrigin,
} from '@packages/event-contracts/streams/product.stream';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import type {
  Cafe24LinkedPayload,
  Cafe24UnlinkedPayload,
  UserEmailVerifiedPayload,
} from '@packages/event-contracts/streams/user.stream';
import {
  getChannelFulfillmentCapabilities,
  type ShipmentSalesChannel,
} from '../../services/channel-fulfillment-capabilities';
import { withMedusaOrderProjectionLock } from '../../services/medusa-order-projection-lock';

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

/**
 * 한 번의 배치 작업이 수만 건을 만들어내는 이벤트. 클레임 순서에서 뒤로 밀린다.
 * 여기 넣을 기준: 지연돼도 "반영이 늦을 뿐" 인가? 고객이 즉시 체감하면 넣지 않는다.
 */
const BULK_EVENT_TYPES = ['ProductSellableQuantityChanged'] as const;

/**
 * 대량 작업이 낸 이벤트임을 표시하는 origin 값. eventType 만으로는 갈리지 않는
 * 경우 — 같은 `ProductMasterActiveVersionChanged` 라도 단건 UI 게시는 고객이
 * 즉시 체감하고 임포트 일괄게시는 아니다 — 를 위해 존재한다.
 * 값 판단 기준은 BULK_EVENT_TYPES 와 같다: 지연돼도 "반영이 늦을 뿐" 인가?
 */
const BULK_ORIGINS: readonly ProductPublishOrigin[] = ['bulk_import'];

/**
 * 한 inbox 핸들러가 슬롯을 물 수 있는 최대 시간.
 *
 * 채택 배치(variant ≤ 4, 25건)의 실측 호출시간이 약 0.73초, 측정 전체에서 최악이던
 * 조합이 22초였다 (설계 스펙 §3). 60초는 최악값의 약 3배다.
 *
 * 이 값은 동시성 1 전환의 선행조건이다. Medusa SDK 에 요청 타임아웃 훅이 없어
 * undici 기본값(300초)에 걸려 있었고, 동시성 2 에서는 한 요청이 멈춰도 절반이
 * 살아있지만 1 에서는 전면 정지가 된다.
 */
export const INBOX_HANDLER_TIMEOUT_MS = 60_000;

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
  private readonly handlerTimeoutMs: number;

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly syncService: PimMedusaSyncService,
    private readonly membershipSyncService: MembershipMedusaSyncService,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
    private readonly medusaClient: MedusaClient,
    private readonly almondAuthClient: AlmondAuthClient,
    private readonly membershipServiceClient: MembershipServiceClient,
    private readonly configService: ConfigService,
    private readonly eventChainService: EventChainService,
  ) {
    this.maxConcurrentHandlers = this.readPositiveIntConfig('INBOX_MAX_CONCURRENT_HANDLERS', 1);
    this.handlerStartIntervalMs = this.readPositiveIntConfig('INBOX_HANDLER_START_INTERVAL_MS', 10000);
    this.processingLeaseMs = this.readPositiveIntConfig('INBOX_PROCESSING_LEASE_MS', 15 * 60 * 1000);
    this.shutdownDrainMs = this.readNonNegativeIntConfig('INBOX_SHUTDOWN_DRAIN_MS', 25000);
    this.maxRetries = this.readPositiveIntConfig('INBOX_MAX_RETRIES', 5);
    this.handlerTimeoutMs = this.readPositiveIntConfig('INBOX_HANDLER_TIMEOUT_MS', INBOX_HANDLER_TIMEOUT_MS);
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
        `shutdownDrainMs=${this.shutdownDrainMs}ms, maxRetries=${this.maxRetries}, ` +
        `handlerTimeoutMs=${this.handlerTimeoutMs}ms)`,
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
    const workerEventTypesSql = sql.join(
      [...INBOX_WORKER_EVENT_TYPES].map((eventType) => sql`${eventType}`),
      sql`, `,
    );
    // 대량 백필성 이벤트는 뒤로 보낸다. 재고 재계산 한 번이 수만 건을 쏟아내는데,
    // 순수 FIFO 면 그 뒤에 들어온 멤버십·배송·주문취소가 큐 길이만큼 지연된다
    // (2026-07-21: 17,604건 적체 → 분당 6건 처리라 멤버십 1건이 이틀 대기).
    // 재고 이벤트는 늦어도 "반영이 늦을 뿐"이지만, 멤버십·배송은 고객이 즉시 체감한다.
    const bulkEventTypesSql = sql.join(
      BULK_EVENT_TYPES.map((eventType) => sql`event_type = ${eventType}`),
      sql` OR `,
    );
    // 출처가 대량인 행도 같은 후순위 레인으로 보낸다. origin 은 payload 가 아니라
    // metadata 에서 읽는다 — ORDER BY 표현식은 LIMIT 1 이어도 후보 행 전부에 대해
    // 계산되는데, payload 는 full snapshot 이라 TOAST 압축해제가 매 틱 붙는다.
    //
    // COALESCE 가 핵심이다. 빼면 마커 없는 행에서 `false OR NULL` = NULL 이 되고,
    // NULL 은 ASC 정렬에서 맨 뒤로 간다 — 정상 이벤트가 통째로 후순위로 밀려
    // 이 강등이 고치려던 문제가 정확히 반대 방향으로 발생한다. 에러는 안 난다.
    // metadata 가 NULL 인 행(옛 컨슈머가 쓴 행)도 같은 경로로 흡수된다.
    const bulkOriginsSql = sql.join(
      BULK_ORIGINS.map((origin) => sql`COALESCE(metadata->>'origin', '') = ${origin}`),
      sql` OR `,
    );
    const excludeInFlightSql =
      inFlightIds.length > 0
        ? sql`AND id NOT IN (${sql.join(
            inFlightIds.map((eventId) => sql`${eventId}`),
            sql`, `,
          )})`
        : sql.empty();

    const rows = await this.dbService.db.execute<InboxWorkerEventRecord>(sql`
      UPDATE ${inboxEvents}
      SET
        status = 'processing',
        attempts = attempts + 1,
        next_attempt_at = NOW() + (${this.processingLeaseMs}::integer * interval '1 millisecond'),
        error_message = NULL
      WHERE id = (
        SELECT id
        FROM ${inboxEvents}
        WHERE event_type IN (${workerEventTypesSql})
          AND (
            (status = 'pending' AND next_attempt_at <= NOW())
            OR (status = 'processing' AND next_attempt_at <= NOW())
          )
          ${excludeInFlightSql}
        ORDER BY (${bulkEventTypesSql} OR ${bulkOriginsSql}), created_at ASC
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

    try {
      await this.withHandlerTimeout(
        this.eventChainService.runWithChain(chainId, eventId, () => this.doProcessInboxEvent(event)),
        `inbox handler ${event.id} (${event.eventType})`,
      );
    } catch (error) {
      // doProcessInboxEvent 는 자체 catch 로 handleFailure 를 부르므로, 여기 도달하는 것은
      // 타임아웃(또는 그 catch 밖에서 터진 예외)뿐이다. 슬롯을 놓아주고 재시도로 넘긴다.
      await this.handleFailure(event, this.getErrorMessage(error));
    }
  }

  /**
   * ⚠️ 한계: in-flight HTTP 요청을 취소하지는 못한다 (SDK 에 signal 훅이 없다).
   * 이 타임아웃은 **슬롯을 놓아주는** 장치이고, 원 요청은 undici 기본값까지 배경에서
   * 계속된다. 그래서 재시도와 원 요청이 겹칠 수 있는데, Medusa 상품 경로는 handle 기준
   * upsert 라 중복 적용이 같은 결과를 낸다. 완전한 취소가 필요해지면 undici global
   * dispatcher(headersTimeout/bodyTimeout)로 올려야 하며, 그때는 Naver·Coupang
   * 클라이언트까지 영향 범위에 들어온다는 점을 함께 판단해야 한다.
   */
  private withHandlerTimeout<T>(work: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${this.handlerTimeoutMs}ms`)),
        this.handlerTimeoutMs,
      );
      timer.unref?.();
    });

    return Promise.race([work, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }

  private async doProcessInboxEvent(event: InboxEventRecord): Promise<void> {
    const eventId = event.id;
    const eventType = event.eventType;
    const aggregateId = event.aggregateId;
    const supersedingEventTypes = this.getSupersedingEventTypes(eventType);
    const supersedingStatuses = this.getSupersedingStatuses(eventType);

    try {
      this.logger.debug(`Processing inbox event: ${eventId} (type: ${eventType})`);

      // aggregateId 기준 더 최신 lifecycle 이벤트가 있으면 현재 이벤트 스킵.
      // Product master delete는 늦게 도착한 이전 active-version retry보다 우선해야 한다.
      //
      // 비교는 전부 DB 안에서 한다. 예전엔 현재 이벤트의 시각을 JS Date 로 뽑아 바인딩했는데,
      // 컬럼이 `timestamp without time zone` 이라 postgres.js 가 naive 값을 **로컬 타임존**으로
      // 파싱한다. UTC 가 아닌 머신(KST 등)에선 그 Date 가 실제보다 9시간 과거가 되어,
      // 좌변(naive 를 UTC 로 해석)과 어긋나 **이벤트가 자기 자신보다 최신**으로 판정됐다.
      // 그 결과 모든 이벤트가 즉시 superseded 로 스킵됐다. 같은 이유로 `ne(id, eventId)` 도 필수.
      const [newerEvent] = await this.dbService.db
        .select({ id: inboxEvents.id })
        .from(inboxEvents)
        .where(
          and(
            eq(inboxEvents.aggregateId, aggregateId),
            ne(inboxEvents.id, eventId),
            inArray(inboxEvents.eventType, supersedingEventTypes),
            gt(
              sql`coalesce(${inboxEvents.eventOccurredAt}, ${inboxEvents.createdAt})`,
              sql`(select coalesce(e.event_occurred_at, e.created_at) from inbox_events e where e.id = ${eventId})`,
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
          const { active, remainingDays } = await this.almondAuthClient.getMembershipDetail(
            linkedPayload.cafe24MemberId,
          );
          // 뉴 아몬드영(membership service + Medusa)이 SSOT.
          // Firebase가 활성이면 멤버십 서비스에 구독 지급 → MembershipStatusChanged 이벤트 → Medusa 동기화 (기존 경로).
          // Firebase가 비활성이거나 이미 활성 구독이 있으면 no-op.
          if (active && remainingDays) {
            await this.membershipServiceClient.grantIfNoActiveMembership(
              linkedPayload.userId,
              remainingDays,
              'cafe24_migration',
            );
          }
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
          // Core order id를 Medusa 채널 매핑으로 역조회한다. payload.channelOrderId는
          // Naver/Coupang 외부 ID일 수도 있으므로 Medusa ID로 신뢰하지 않는다.
          const shippedPayload = event.payload as {
            fulfillmentId: string;
            orderId: string;
            channelOrderId?: string;
            trackingInfo?: { carrier?: string; trackingNumber?: string };
            shippedAt?: string;
          };

          const [shippedMapping] = await this.dbService.db
            .select({ channelOrderId: wmsOrderMappings.channelOrderId })
            .from(wmsOrderMappings)
            .where(
              and(eq(wmsOrderMappings.wmsOrderId, shippedPayload.orderId), eq(wmsOrderMappings.salesChannel, 'medusa')),
            )
            .limit(1);
          const shippedMedusaOrderId = shippedMapping?.channelOrderId ?? null;

          if (!shippedMedusaOrderId) {
            this.logger.debug(`[CoreFulfillmentShipped] Medusa 매핑 없음, 스킵: orderId=${shippedPayload.orderId}`);
            break;
          }

          await withMedusaOrderProjectionLock(this.dbService, shippedMedusaOrderId, () =>
            this.medusaClient.updateOrderShippingProjection(shippedMedusaOrderId, {
              status: 'shipped',
              fulfillmentId: shippedPayload.fulfillmentId,
              carrier: shippedPayload.trackingInfo?.carrier,
              trackingNumber: shippedPayload.trackingInfo?.trackingNumber,
              shippedAt: shippedPayload.shippedAt,
            }),
          );
          this.logger.log(
            `[CoreFulfillmentShipped] Medusa 배송 시작 동기화 완료: orderId=${shippedPayload.orderId}, medusaOrderId=${shippedMedusaOrderId}`,
          );
          break;
        }

        case 'CoreFulfillmentDelivered': {
          // Core WMS에서 FO 배송 완료 시 Medusa order metadata를 delivered로 갱신.
          // Core order id를 실제 Medusa 채널 매핑으로 역조회한다.
          const deliveredPayload = event.payload as {
            fulfillmentId: string;
            orderId: string;
            channelOrderId?: string;
            deliveredAt?: string;
          };

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
          const deliveredMedusaOrderId = deliveredMapping?.channelOrderId ?? null;

          if (!deliveredMedusaOrderId) {
            this.logger.debug(`[CoreFulfillmentDelivered] Medusa 매핑 없음, 스킵: orderId=${deliveredPayload.orderId}`);
            break;
          }

          await withMedusaOrderProjectionLock(this.dbService, deliveredMedusaOrderId, () =>
            this.medusaClient.updateOrderShippingProjection(deliveredMedusaOrderId, {
              status: 'delivered',
              fulfillmentId: deliveredPayload.fulfillmentId,
              deliveredAt: deliveredPayload.deliveredAt,
            }),
          );
          this.logger.log(
            `[CoreFulfillmentDelivered] Medusa 배송 완료 동기화 완료: orderId=${deliveredPayload.orderId}, medusaOrderId=${deliveredMedusaOrderId}`,
          );
          break;
        }

        case 'CoreOrderCancelled': {
          // Core(WMS)가 주문을 취소했을 때 Medusa order도 canceled로 동기화한다.
          // channelOrderId는 외부 채널에 따라 의미가 달라질 수 있으므로 Core order id와
          // salesChannel='medusa' 매핑을 함께 확인한 경우에만 Medusa를 호출한다.
          const cancelPayload: { orderId: string; channelOrderId?: string } = event.payload;

          // wmsOrderId 는 채널어댑터가 주문 수집 때 만든 id 라 Core 가 저장한 salesOrder.id 와 다르다.
          // Core 는 취소 이벤트에 channelOrderId 를 실어 보내므로 그걸 우선 키로 쓴다.
          const [mapping] = await this.dbService.db
            .select({
              salesChannel: wmsOrderMappings.salesChannel,
              channelOrderId: wmsOrderMappings.channelOrderId,
            })
            .from(wmsOrderMappings)
            .where(
              cancelPayload.channelOrderId
                ? eq(wmsOrderMappings.channelOrderId, cancelPayload.channelOrderId)
                : eq(wmsOrderMappings.wmsOrderId, cancelPayload.orderId),
            )
            .limit(1);

          if (!mapping) {
            this.logger.debug(
              `[CoreOrderCancelled] Medusa 매핑 없음, 취소 동기화 스킵: orderId=${cancelPayload.orderId}`,
            );
            break;
          }

          const capabilities = getChannelFulfillmentCapabilities(mapping.salesChannel as ShipmentSalesChannel);
          if (mapping.salesChannel !== 'medusa' || !capabilities?.automatedCancellation) {
            const reason = `${mapping.salesChannel} order cancellation requires manual channel adjustment`;
            await this.dbService.db
              .insert(channelDispatchOperations)
              .values({
                inboxEventId: eventId,
                dispatchAttemptId: null,
                shipmentId: null,
                salesOrderId: cancelPayload.orderId,
                operation: 'cancel',
                channel: mapping.salesChannel,
                externalOrderId: mapping.channelOrderId,
                providerIdempotencyKey: `cancel:${eventId}:${cancelPayload.orderId}`,
                requestSnapshot: { eventType, payload: cancelPayload },
                status: 'manual_adjustment_required',
                errorMessage: reason,
                updatedAt: new Date(),
              })
              .onConflictDoNothing();
            this.logger.warn(`${reason}: ${mapping.channelOrderId}`);
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

  // 실패 처리: 재시도 횟수 증가 + 백오프 + DLQ
  private async handleFailure(event: InboxEventRecord, errorMessage: string): Promise<void> {
    const eventId = event.id;
    const attempts = Number.isInteger(event.attempts) && event.attempts > 0 ? event.attempts : 1;

    if (attempts >= this.maxRetries) {
      // 최대 재시도 횟수 초과 → failed (DLQ)
      const applied = await this.applyFailureUpdate(eventId, attempts, {
        status: 'failed',
        attempts,
        errorMessage,
        failedAt: new Date(),
      });
      if (!applied) return;

      this.logger.error(`Inbox event failed permanently: ${eventId}`);
    } else {
      const nextAttemptAt = new Date(Date.now() + Math.pow(2, attempts) * 1000);

      const applied = await this.applyFailureUpdate(eventId, attempts, {
        status: 'pending',
        attempts,
        errorMessage,
        nextAttemptAt,
      });
      if (!applied) return;

      this.logger.warn(
        `Inbox event retry scheduled: ${eventId} (attempts: ${attempts}, next: ${nextAttemptAt.toISOString()})`,
      );
    }
  }

  /**
   * `handleFailure` 갱신을 "이 호출이 클레임됐을 때의 attempts 세대와 지금 행의 attempts 가
   * 여전히 같을 때만" 적용한다 — stock_ledgers.version 과 같은 낙관적 잠금 패턴이다.
   *
   * `processInboxEvent` 의 타임아웃이 슬롯을 놓아준 뒤에도 방치된 원 요청은 계속 실행되다가
   * 뒤늦게 자체 에러로 `doProcessInboxEvent` 의 내부 catch 를 태워 handleFailure 를 다시 부를 수
   * 있다. 그 사이 이벤트가 재클레임돼 처리됐다면(`claimNextInboxEvent` 가 매 클레임마다 attempts
   * 를 원자적으로 올린다) 지금 행의 attempts 는 이 스냅샷과 더 이상 같지 않다 — 그 경우 이 두 번째
   * 호출은 이미 끝난(또는 진행 중인) 최신 시도를 스테일 데이터로 덮어써서는 안 되므로 조용히 무시한다.
   */
  private async applyFailureUpdate(
    eventId: string,
    claimedAttempts: number,
    values: Partial<typeof inboxEvents.$inferInsert>,
  ): Promise<boolean> {
    const updated = await this.dbService.db
      .update(inboxEvents)
      .set(values)
      .where(and(eq(inboxEvents.id, eventId), eq(inboxEvents.attempts, claimedAttempts)))
      .returning({ id: inboxEvents.id });

    if (updated.length === 0) {
      this.logger.warn(
        `Stale failure ignored: inbox event ${eventId} already advanced past attempt ${claimedAttempts} ` +
          '(reclaimed and reprocessed since an abandoned handler timed out)',
      );
      return false;
    }

    return true;
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
