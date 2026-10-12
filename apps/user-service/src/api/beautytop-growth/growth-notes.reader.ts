import { Injectable } from '@nestjs/common';
import { GrowthNoteTargetDto } from './dto/growth-note.dto';
import { GrowthNotesRepository } from './growth-notes.repository';

@Injectable()
export class GrowthNotesReader {
  constructor(private readonly repository: GrowthNotesRepository) {}

  list(userId: string, target: GrowthNoteTargetDto) {
    return this.repository.list(userId, target);
  }
}
