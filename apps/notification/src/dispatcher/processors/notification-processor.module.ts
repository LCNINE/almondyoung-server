// apps/notification/src/dispatcher/processors/notification-processor.module.ts
// Redis가 있을 때만 이 모듈을 import하여 NotificationProcessor를 등록합니다.
// Redis가 없으면 이 파일을 import하지 않도록 DispatcherModule에서 조건부로 처리합니다.

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationProcessor } from './notification.processor';

@Module({
    imports: [
        BullModule.registerQueue({
            name: 'notification',
        }),
    ],
    providers: [NotificationProcessor],
})
export class NotificationProcessorModule { }

