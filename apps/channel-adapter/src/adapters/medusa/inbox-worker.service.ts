import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { inboxEvents } from '../../schema';
import { eq, and, lte } from 'drizzle-orm';
import { v7 } from 'uuid';
import { PimMedusaSyncService } from './pim-medusa-sync.service';
import { MembershipMedusaSyncService } from './membership-medusa-sync.service';
import { FirebaseMembershipSyncService } from './firebase-membership-sync.service';
import { AlmondAuthClient } from '../almond-auth/almond-auth.client';
import { EventChainService, generateMessageId } from '@app/events';
import type { PimActiveVersionChangedEvent, ChannelAdapterSchema } from '../../types';
import type { CategoryChangedPayload } from '@packages/event-contracts/streams/product.stream';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import type { Cafe24LinkedPayload, Cafe24UnlinkedPayload } from '@packages/event-contracts/streams/user.stream';

@Injectable()
export class InboxWorkerService implements OnModuleInit {
  private readonly logger = new Logger(InboxWorkerService.name);
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly syncService: PimMedusaSyncService,
    private readonly membershipSyncService: MembershipMedusaSyncService,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
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
      const events = await this.dbService.db
        .select()
        .from(inboxEvents)
        .where(and(eq(inboxEvents.status, 'pending'), lte(inboxEvents.nextAttemptAt, new Date())))
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

    try {
      this.logger.debug(`Processing inbox event: ${eventId} (type: ${eventType})`);

      // 상태를 processing으로 변경 (동시성 제어)
      await this.dbService.db.update(inboxEvents).set({ status: 'processing' }).where(eq(inboxEvents.id, eventId));

      // Route based on event type
      switch (eventType) {
        case 'ProductMasterActiveVersionChanged':
          const productPayload: PimActiveVersionChangedEvent = event.payload;
          await this.syncService.handleActiveVersionChanged(productPayload);
          break;

        case 'CategoryChanged':
          const categoryPayload: CategoryChangedPayload = event.payload;
          await this.syncService.handleCategoryChanged(categoryPayload);
          break;

        case 'MembershipStatusChanged':
          const membershipPayload: MembershipStatusChangedPayload = event.payload;
          await this.membershipSyncService.handleMembershipStatusChanged(membershipPayload);
          break;

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
