import { INTERNAL_KEY_ENV } from '@app/authorization';
import { Module } from '@nestjs/common';
import { InternalWebPushController, WebPushController } from './controllers/web-push.controller';
import { WebPushService } from './services/web-push.service';

@Module({
  controllers: [WebPushController, InternalWebPushController],
  providers: [WebPushService, { provide: INTERNAL_KEY_ENV, useValue: 'NOTIFICATION_INTERNAL_KEY' }],
})
export class WebPushModule {}
