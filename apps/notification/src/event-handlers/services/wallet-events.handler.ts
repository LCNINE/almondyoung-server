import { Controller, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { WalletEvents, WalletTopupSuccessPayload, WalletWithdrawalRequestedPayload } from '../../events/wallet.events';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../../dispatcher/dto/send-notification.dto';

@Controller()
export class WalletEventsHandler {
  private readonly logger = new Logger(WalletEventsHandler.name);

  constructor(
    private readonly eventMappingService: EventMappingService,
    private readonly notificationDispatcherService: NotificationDispatcherService,
  ) {}

  @TypedEventPattern<WalletEvents, 'WALLET_TOPUP_SUCCESS'>('WALLET_TOPUP_SUCCESS')
  async onWalletTopupSuccess(payload: WalletTopupSuccessPayload) {
    this.logger.log(`Received WALLET_TOPUP_SUCCESS event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('WALLET_TOPUP_SUCCESS');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for WALLET_TOPUP_SUCCESS not found or inactive.`);
        return;
      }

      // 이벤트 payload에서 user 정보를 직접 사용
      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: payload.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          amount: payload.amount,
          currency: payload.currency,
          transactionId: payload.transactionId,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched WALLET_TOPUP_SUCCESS notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`Failed to process WALLET_TOPUP_SUCCESS notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<WalletEvents, 'WALLET_WITHDRAWAL_REQUESTED'>('WALLET_WITHDRAWAL_REQUESTED')
  async onWalletWithdrawalRequested(payload: WalletWithdrawalRequestedPayload) {
    this.logger.log(`Received WALLET_WITHDRAWAL_REQUESTED event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('WALLET_WITHDRAWAL_REQUESTED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for WALLET_WITHDRAWAL_REQUESTED not found or inactive.`);
        return;
      }

      // 이벤트 payload에서 user 정보를 직접 사용
      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: payload.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          amount: payload.amount,
          currency: payload.currency,
          withdrawalId: payload.withdrawalId,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched WALLET_WITHDRAWAL_REQUESTED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`Failed to process WALLET_WITHDRAWAL_REQUESTED notification: ${error.message}`, error.stack);
    }
  }
}
