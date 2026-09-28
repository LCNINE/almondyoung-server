import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { UserContactClient } from '@app/shared';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { formatDate } from '../../shared/utils/template-helpers';
import { CouponExpiryNoticeDto } from '../dto/coupon-expiry-notice.dto';
import { notifyMember } from '../handlers/notify-member';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';

@ApiTags('internal-notifications')
@Controller('internal/notifications')
export class InternalNotificationController {
  private readonly logger = new Logger(InternalNotificationController.name);

  constructor(
    private readonly dispatcher: NotificationDispatcherService,
    private readonly eventMappings: EventMappingService,
    private readonly contacts: UserContactClient,
  ) {}

  @Post('coupon-expiry')
  @InternalOnly()
  @HttpCode(202)
  async couponExpiry(@Body() dto: CouponExpiryNoticeDto): Promise<void> {
    const earliest = [...dto.coupons].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
    await notifyMember(
      { dispatcher: this.dispatcher, eventMappings: this.eventMappings, contacts: this.contacts, logger: this.logger },
      {
        eventKey: 'COUPON_EXPIRING',
        userId: dto.userId,
        payload: dto,
        variables: (contact) => ({
          name: contact.username || '고객',
          couponNames: dto.coupons.map((c) => c.name).join(', '),
          couponCount: dto.coupons.length,
          expiresAt: formatDate(earliest.expiresAt),
        }),
      },
    );
  }
}
