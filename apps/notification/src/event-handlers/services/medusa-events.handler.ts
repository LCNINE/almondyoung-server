import { Controller, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { MedusaEvents, OrderCreatedPayload, PaymentCompletedPayload } from '../../events/medusa.events';
import { EventMappingService } from '../services/event-mapping.service';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../../dispatcher/dto/send-notification.dto';

@Controller()
export class MedusaEventsHandler {
  private readonly logger = new Logger(MedusaEventsHandler.name);

  constructor(
    private readonly eventMappingService: EventMappingService,
    private readonly notificationDispatcherService: NotificationDispatcherService,
  ) {}

  @TypedEventPattern<MedusaEvents, 'ORDER_CREATED'>('ORDER_CREATED')
  async onOrderCreated(payload: OrderCreatedPayload) {
    this.logger.log(`Received ORDER_CREATED event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('ORDER_CREATED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for ORDER_CREATED not found or inactive.`);
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
          orderId: payload.orderId,
          totalAmount: payload.totalAmount,
          currency: payload.currency,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched ORDER_CREATED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`Failed to process ORDER_CREATED notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<MedusaEvents, 'PAYMENT_COMPLETED'>('PAYMENT_COMPLETED')
  async onPaymentCompleted(payload: PaymentCompletedPayload) {
    this.logger.log(`Received PAYMENT_COMPLETED event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('PAYMENT_COMPLETED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for PAYMENT_COMPLETED not found or inactive.`);
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
          orderId: payload.orderId,
          paymentAmount: payload.paymentAmount,
          currency: payload.currency,
          customerEmail: payload.customerEmail || payload.userId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched PAYMENT_COMPLETED notification for ${payload.userId}`);
    } catch (error) {
      this.logger.error(`Failed to process PAYMENT_COMPLETED notification: ${error.message}`, error.stack);
    }
  }
}
