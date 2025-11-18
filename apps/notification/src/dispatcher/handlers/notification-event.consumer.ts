import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  OrderCreatedPayload,
  OrderPaymentCompletedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import {
  UserVerificationPayload,
  UserFindIdPayload,
  UserResetPasswordPayload,
} from '@packages/event-contracts/streams/user.stream';
import {
  WalletTopupSuccessPayload,
  WalletWithdrawalRequestedPayload,
} from '@packages/event-contracts/streams/wallet.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';

import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { EventMappingService } from '../../shared/services/event-mapping.service';

@Controller()
@UseInterceptors(EventTypeGuard)
export class NotificationEventConsumer {
  private readonly logger = new Logger(NotificationEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  // ===== Order Events =====

  @OnEvent('orders.events.v1', 'OrderCreated')
  async onOrderCreated(
    @EventEnvelope() envelope: DomainEvent<OrderCreatedPayload>,
    @EventPayload() payload: OrderCreatedPayload,
  ) {
    this.logger.log(`[Event] Received OrderCreated: ${payload.orderId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('ORDER_CREATED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for ORDER_CREATED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.customerId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          orderId: payload.orderId,
          totalAmount: payload.totalAmount,
          currency: payload.currency,
          customerEmail: payload.customerId, // TODO: 실제 email 조회 필요
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched ORDER_CREATED notification for ${payload.customerId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process ORDER_CREATED notification: ${error.message}`, error.stack);
      throw error; // Re-throw to send to DLQ
    }
  }

  @OnEvent('orders.events.v1', 'OrderPaymentCompleted')
  async onPaymentCompleted(
    @EventEnvelope() envelope: DomainEvent<OrderPaymentCompletedPayload>,
    @EventPayload() payload: OrderPaymentCompletedPayload,
  ) {
    this.logger.log(`[Event] Received OrderPaymentCompleted: ${payload.orderId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_COMPLETED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_COMPLETED not found or inactive.`);
        return;
      }

      // TODO: orderId로 order 조회하여 userId 가져오기
      const sendDto: SendNotificationDto = {
        userId: payload.orderId, // 임시
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          orderId: payload.orderId,
          paymentAmount: payload.amount,
          currency: payload.currency,
          customerEmail: payload.orderId, // 임시
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched PAYMENT_COMPLETED notification for ${payload.orderId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process PAYMENT_COMPLETED notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ===== User Events =====

  @OnEvent('users.events.v1', 'UserVerification')
  async onUserVerification(
    @EventEnvelope() envelope: DomainEvent<UserVerificationPayload>,
    @EventPayload() payload: UserVerificationPayload,
  ) {
    this.logger.log(`[Event] Received UserVerification: ${payload.userId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_VERIFICATION not found or inactive.`);
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
          name: payload.name,
          email: payload.email,
          verificationToken: payload.verificationToken,
          callbackUrl: payload.callbackUrl,
          redirectTo: payload.redirectTo,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_VERIFICATION notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_VERIFICATION notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('users.events.v1', 'UserFindId')
  async onUserFindId(
    @EventEnvelope() envelope: DomainEvent<UserFindIdPayload>,
    @EventPayload() payload: UserFindIdPayload,
  ) {
    this.logger.log(`[Event] Received UserFindId: ${payload.email} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_FIND_ID');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_FIND_ID not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: 'unknown', // UserFindIdPayload에는 userId가 없음
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          email: payload.email,
          loginId: payload.loginId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_FIND_ID notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_FIND_ID notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OnEvent('users.events.v1', 'UserResetPassword')
  async onUserResetPassword(
    @EventEnvelope() envelope: DomainEvent<UserResetPasswordPayload>,
    @EventPayload() payload: UserResetPasswordPayload,
  ) {
    this.logger.log(`[Event] Received UserResetPassword: ${payload.email} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_RESET_PASSWORD');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_RESET_PASSWORD not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: 'unknown', // UserResetPasswordPayload에는 userId가 없음
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          email: payload.email,
          verificationToken: payload.verificationToken,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_RESET_PASSWORD notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_RESET_PASSWORD notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ===== Wallet Events =====

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

