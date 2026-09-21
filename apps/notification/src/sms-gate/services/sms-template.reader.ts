import { Injectable, Logger } from '@nestjs/common';
import { UserContact, UserContactClient } from '@app/shared';
import { SmsTemplate } from '../../../database/schemas/notification-schema';
import { SmsGateRepository } from '../repositories/sms-gate.repository';

export interface SmsTemplateListItem extends SmsTemplate {
  createdByName: string | null;
}

@Injectable()
export class SmsTemplateReader {
  private readonly logger = new Logger(SmsTemplateReader.name);

  constructor(
    private readonly repository: SmsGateRepository,
    private readonly userContactClient: UserContactClient,
  ) {}

  async list(): Promise<SmsTemplateListItem[]> {
    const templates = await this.repository.listTemplates();
    const creators = await this.loadCreators([...new Set(templates.map((t) => t.createdBy))]);
    return templates.map((t) => ({ ...t, createdByName: creators.get(t.createdBy)?.username ?? null }));
  }

  private async loadCreators(userIds: string[]): Promise<Map<string, UserContact>> {
    try {
      return await this.userContactClient.findContacts(userIds);
    } catch (error) {
      this.logger.warn(`템플릿 작성자 이름 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }
}
