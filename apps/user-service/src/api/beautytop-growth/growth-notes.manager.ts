import { DbService, InjectDb } from '@app/db';
import { BadRequestError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import type { UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { GROWTH_ACTIONS, GrowthNoteTargetDto, RecordGrowthNoteDto } from './dto/growth-note.dto';
import { GrowthNotesRepository } from './growth-notes.repository';

@Injectable()
export class GrowthNotesManager {
  constructor(
    private readonly repository: GrowthNotesRepository,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async record(userId: string, dto: RecordGrowthNoteDto) {
    if (!GROWTH_ACTIONS.includes(dto.action) || (dto.memo?.length ?? 0) > 240)
      throw new BadRequestError('올바른 실행 기록을 입력해 주세요.');
    await this.dbService.run(async (tx) => {
      if (!(await this.repository.isMyShop(userId, dto, tx)))
        throw new BadRequestError('등록한 내 샵에만 실행을 기록할 수 있습니다.');
      await this.repository.record(userId, dto, tx);
    });
  }

  remove(userId: string, target: GrowthNoteTargetDto, id: string) {
    return this.repository.remove(userId, target, id);
  }
}
