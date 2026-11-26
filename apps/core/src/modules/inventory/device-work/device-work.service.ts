import { Injectable } from '@nestjs/common';
import { DeviceWorkManager } from './device-work.manager';
import { DeviceWorkReader } from './device-work.reader';
import type { ReportUnresolvedOperationsDto } from './dto/device-work.dto';

@Injectable()
export class DeviceWorkService {
  constructor(
    private readonly manager: DeviceWorkManager,
    private readonly reader: DeviceWorkReader,
  ) {}

  report(actorId: string, deviceId: string, dto: ReportUnresolvedOperationsDto) {
    return this.manager.report(actorId, deviceId, dto);
  }

  listOpen() {
    return this.reader.listOpen();
  }

  resolve(actorId: string, operationKey: string, action: 'abandon' | 'dismiss') {
    return this.manager.resolve(actorId, operationKey, action);
  }
}
