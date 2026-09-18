import { Injectable } from '@nestjs/common';
import { SmsDevice } from '../../../database/schemas/notification-schema';
import { CreateSmsDeviceDto, UpdateSmsDeviceDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { SmsDeviceManager } from './sms-device.manager';
import { SmsDeviceReader, SmsDeviceStatus } from './sms-device.reader';

@Injectable()
export class SmsDevicesService {
  constructor(
    private readonly deviceReader: SmsDeviceReader,
    private readonly deviceManager: SmsDeviceManager,
    private readonly repository: SmsGateRepository,
  ) {}

  async list(): Promise<{ devices: SmsDeviceStatus[]; pendingCount: number }> {
    const [devices, pendingCount] = await Promise.all([
      this.deviceReader.loadStatuses(new Date()),
      this.repository.countPending(),
    ]);
    return { devices, pendingCount };
  }

  create(dto: CreateSmsDeviceDto): Promise<SmsDevice> {
    return this.deviceManager.create(dto);
  }

  update(id: string, dto: UpdateSmsDeviceDto): Promise<void> {
    return this.deviceManager.update(id, dto);
  }

  delete(id: string): Promise<void> {
    return this.deviceManager.delete(id);
  }
}
