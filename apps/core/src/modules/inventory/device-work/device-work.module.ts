import { Module } from '@nestjs/common';
import { DeviceWorkController } from './device-work.controller';
import { DeviceWorkManager } from './device-work.manager';
import { DeviceWorkReader } from './device-work.reader';
import { DeviceWorkService } from './device-work.service';

/** 물류앱 기기에만 남은 결과 모름 — 기기 보고, 관리자 판정·정리 */
@Module({
  controllers: [DeviceWorkController],
  providers: [DeviceWorkService, DeviceWorkManager, DeviceWorkReader],
})
export class DeviceWorkModule {}
