import { Injectable } from '@nestjs/common';
import { GrowthNoteTargetDto, RecordGrowthNoteDto } from './dto/growth-note.dto';
import { GrowthNotesManager } from './growth-notes.manager';
import { GrowthNotesReader } from './growth-notes.reader';

@Injectable()
export class GrowthNotesService {
  constructor(
    private readonly reader: GrowthNotesReader,
    private readonly manager: GrowthNotesManager,
  ) {}

  list(userId: string, target: GrowthNoteTargetDto) {
    return this.reader.list(userId, target);
  }

  async record(userId: string, dto: RecordGrowthNoteDto) {
    await this.manager.record(userId, dto);
    return this.reader.list(userId, dto);
  }

  async remove(userId: string, target: GrowthNoteTargetDto, id: string) {
    await this.manager.remove(userId, target, id);
    return this.reader.list(userId, target);
  }
}
