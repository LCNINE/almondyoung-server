import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { SmsTemplate } from '../../../database/schemas/notification-schema';
import { CreateSmsTemplateDto, UpdateSmsTemplateDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

@Injectable()
export class SmsTemplateManager {
  constructor(private readonly repository: SmsGateRepository) {}

  create(dto: CreateSmsTemplateDto, createdBy: string): Promise<SmsTemplate> {
    return this.repository.createTemplate({ ...dto, createdBy });
  }

  async update(id: string, dto: UpdateSmsTemplateDto): Promise<void> {
    await this.getOrThrow(id);
    await this.repository.updateTemplate(id, dto);
  }

  async delete(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.repository.deleteTemplate(id);
  }

  private async getOrThrow(id: string): Promise<SmsTemplate> {
    const template = await this.repository.findTemplateById(id);
    if (!template) throw new NotFoundError(`템플릿을 찾을 수 없습니다: ${id}`);
    return template;
  }
}
