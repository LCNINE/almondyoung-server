// apps/notification/src/dispatcher/handlers/wallet-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  WalletTopupSuccessPayload,
  WalletWithdrawalRequestedPayload,
} from '@packages/event-contracts/streams/wallet.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';

/**
 * Wallet Service 이벤트 컨슈머
 * 
 * wallet 서비스가 발행한 이벤트를 수신하여 알림을 발송합니다.
 * - WalletTopupSuccess: 충전 성공
 * - WalletWithdrawalRequested: 출금 요청
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class WalletEventConsumer {
  private readonly logger = new Logger(WalletEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @OnEvent('wallet.events.v1', 'WalletTopupSuccess')
  async onWalletTopupSuccess(
    @EventEnvelope() envelope: DomainEvent<WalletTopupSuccessPayload>,
    @EventPayload() payload: WalletTopupSuccessPayload,
  ) {
    this.logger.log(`[Event] Received WalletTopupSuccess: ${payload.userId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('WALLET_TOPUP_SUCCESS');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for WALLET_TOPUP_SUCCESS not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          amount: payload.amount,
          currency: payload.currency,
          transactionId: payload.transactionId,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched WALLET_TOPUP_SUCCESS notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process WALLET_TOPUP_SUCCESS notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('wallet.events.v1', 'WalletWithdrawalRequested')
  async onWalletWithdrawalRequested(
    @EventEnvelope() envelope: DomainEvent<WalletWithdrawalRequestedPayload>,
    @EventPayload() payload: WalletWithdrawalRequestedPayload,
  ) {
    this.logger.log(`[Event] Received WalletWithdrawalRequested: ${payload.userId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('WALLET_WITHDRAWAL_REQUESTED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for WALLET_WITHDRAWAL_REQUESTED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          amount: payload.amount,
          currency: payload.currency,
          withdrawalId: payload.withdrawalId,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched WALLET_WITHDRAWAL_REQUESTED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process WALLET_WITHDRAWAL_REQUESTED notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}

