import { Injectable } from '@nestjs/common';
import { SmsRecipientGroup } from '../../../database/schemas/notification-schema';
import { AddSmsGroupRecipientsDto, ImportSupabaseGroupDto } from '../dto';
import { RecipientGroupRow, SmsGateRepository } from '../repositories/sms-gate.repository';
import { GroupRecipientsResult, SmsRecipientGroupManager } from './sms-recipient-group.manager';

@Injectable()
export class SmsRecipientGroupsService {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly groupManager: SmsRecipientGroupManager,
  ) {}

  list(): Promise<RecipientGroupRow[]> {
    return this.repository.listRecipientGroups();
  }

  create(name: string, createdBy: string): Promise<SmsRecipientGroup> {
    return this.groupManager.create(name, createdBy);
  }

  addRecipients(groupId: string, dto: AddSmsGroupRecipientsDto): Promise<GroupRecipientsResult> {
    return this.groupManager.addRecipients(groupId, dto);
  }

  importSupabase(dto: ImportSupabaseGroupDto, createdBy: string): Promise<GroupRecipientsResult> {
    return this.groupManager.importSupabase(dto, createdBy);
  }

  delete(groupId: string): Promise<void> {
    return this.groupManager.delete(groupId);
  }
}
