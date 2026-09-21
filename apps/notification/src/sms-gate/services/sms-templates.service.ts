import { Injectable } from '@nestjs/common';
import { SmsTemplate } from '../../../database/schemas/notification-schema';
import { CreateSmsTemplateDto, UpdateSmsTemplateDto } from '../dto';
import { SmsTemplateManager } from './sms-template.manager';
import { SmsTemplateListItem, SmsTemplateReader } from './sms-template.reader';

@Injectable()
export class SmsTemplatesService {
  constructor(
    private readonly templateReader: SmsTemplateReader,
    private readonly templateManager: SmsTemplateManager,
  ) {}

  list(): Promise<SmsTemplateListItem[]> {
    return this.templateReader.list();
  }

  create(dto: CreateSmsTemplateDto, createdBy: string): Promise<SmsTemplate> {
    return this.templateManager.create(dto, createdBy);
  }

  update(id: string, dto: UpdateSmsTemplateDto): Promise<void> {
    return this.templateManager.update(id, dto);
  }

  delete(id: string): Promise<void> {
    return this.templateManager.delete(id);
  }
}
