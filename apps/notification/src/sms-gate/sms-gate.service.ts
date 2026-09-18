import { Injectable } from '@nestjs/common';
import { SmsDevice } from '../../database/schemas/notification-schema';
import { CreateSmsDeviceDto, SendSmsGateMessageDto, UpdateSmsDeviceDto } from './dto/sms-gate.dto';
import { SmsDeviceManager } from './sms-device.manager';
import { SmsDeviceReader, SmsDeviceStatus } from './sms-device.reader';
import { SmsGateRepository } from './sms-gate.repository';
import { SmsGateSendResult, SmsMessageManager } from './sms-message.manager';

@Injectable()
export class SmsGateService {
  constructor(
    private readonly deviceReader: SmsDeviceReader,
    private readonly deviceManager: SmsDeviceManager,
    private readonly messageManager: SmsMessageManager,
    private readonly repository: SmsGateRepository,
  ) {}

  async listDevices(): Promise<{ devices: SmsDeviceStatus[]; pendingCount: number }> {
    const [devices, pendingCount] = await Promise.all([
      this.deviceReader.loadStatuses(new Date()),
      this.repository.countPending(),
    ]);
    return { devices, pendingCount };
  }

  createDevice(dto: CreateSmsDeviceDto): Promise<SmsDevice> {
    return this.deviceManager.create(dto);
  }

  updateDevice(id: string, dto: UpdateSmsDeviceDto): Promise<void> {
    return this.deviceManager.update(id, dto);
  }

  deleteDevice(id: string): Promise<void> {
    return this.deviceManager.delete(id);
  }

  send(dto: SendSmsGateMessageDto, sentBy: string): Promise<SmsGateSendResult> {
    return this.messageManager.send(dto, sentBy);
  }

  findMessages(ids: string[]) {
    return this.repository.findMessages(ids);
  }
}
