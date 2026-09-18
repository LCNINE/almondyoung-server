import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { SmsDevice } from '../../database/schemas/notification-schema';
import { CreateSmsDeviceDto, UpdateSmsDeviceDto } from './dto/sms-gate.dto';
import { SmsGateRepository } from './sms-gate.repository';

@Injectable()
export class SmsDeviceManager {
  constructor(private readonly repository: SmsGateRepository) {}

  async create(dto: CreateSmsDeviceDto): Promise<SmsDevice> {
    if (await this.repository.findDeviceByDeviceId(dto.deviceId)) {
      throw new ConflictError(`이미 등록된 Device ID 입니다: ${dto.deviceId}`);
    }
    return this.repository.createDevice(dto);
  }

  async update(id: string, dto: UpdateSmsDeviceDto): Promise<void> {
    await this.getOrThrow(id);
    await this.repository.updateDevice(id, dto);
  }

  async delete(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.repository.deleteDevice(id);
  }

  private async getOrThrow(id: string): Promise<SmsDevice> {
    const device = await this.repository.findDeviceById(id);
    if (!device) throw new NotFoundError(`디바이스를 찾을 수 없습니다: ${id}`);
    return device;
  }
}
