import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { SmsRecipientGroup } from '../../../database/schemas/notification-schema';
import { SupabasePlacesClient } from '../clients/supabase-places.client';
import { AddSmsGroupRecipientsDto, ImportSupabaseGroupDto } from '../dto';
import { SmsGateRepository } from '../repositories/sms-gate.repository';
import { RawRecipient, toGroupRecipientRows } from '../utils/group-recipients';

export interface GroupRecipientsResult {
  groupId: string;
  received: number;
  added: number;
  /** 휴대폰 번호가 아니거나 이번 요청 안에서 겹친 행 */
  skipped: number;
  /** 이미 그룹에 있던 번호 */
  duplicated: number;
}

@Injectable()
export class SmsRecipientGroupManager {
  constructor(
    private readonly repository: SmsGateRepository,
    private readonly supabasePlacesClient: SupabasePlacesClient,
  ) {}

  async create(name: string, createdBy: string): Promise<SmsRecipientGroup> {
    await this.assertNameFree(name);
    return this.repository.createRecipientGroup(name.trim(), createdBy);
  }

  async addRecipients(groupId: string, dto: AddSmsGroupRecipientsDto): Promise<GroupRecipientsResult> {
    if (!(await this.repository.findRecipientGroup(groupId))) {
      throw new NotFoundError(`수신자 그룹을 찾을 수 없습니다: ${groupId}`);
    }
    return this.insert(groupId, dto.recipients);
  }

  /** 조회를 먼저 끝내고 그룹을 만든다. Supabase 가 실패하면 빈 그룹이 남지 않는다. */
  async importSupabase(dto: ImportSupabaseGroupDto, createdBy: string): Promise<GroupRecipientsResult> {
    await this.assertNameFree(dto.name);
    const places = await this.supabasePlacesClient.fetchPlaces(dto.category);
    const group = await this.repository.createRecipientGroup(dto.name.trim(), createdBy, 'supabase');
    return this.insert(
      group.id,
      places.map((place) => ({ name: place.shop_name, phone: place.phone })),
    );
  }

  async delete(groupId: string): Promise<void> {
    if (!(await this.repository.findRecipientGroup(groupId))) {
      throw new NotFoundError(`수신자 그룹을 찾을 수 없습니다: ${groupId}`);
    }
    await this.repository.deleteRecipientGroup(groupId);
  }

  private async insert(groupId: string, raws: RawRecipient[]): Promise<GroupRecipientsResult> {
    const { rows, skipped } = toGroupRecipientRows(raws);
    const added = await this.repository.addGroupRecipients(rows.map((row) => ({ ...row, groupId })));
    return { groupId, received: raws.length, added, skipped, duplicated: rows.length - added };
  }

  private async assertNameFree(name: string): Promise<void> {
    if (await this.repository.findRecipientGroupByName(name.trim())) {
      throw new ConflictError(`'${name.trim()}' 그룹이 이미 있습니다. 기존 그룹에 추가하거나 다른 이름을 쓰세요.`);
    }
  }
}
