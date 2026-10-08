import { Module } from '@nestjs/common';
import { GrowthNotesController } from './growth-notes.controller';
import { GrowthNotesService } from './growth-notes.service';
import { GrowthNotesReader } from './growth-notes.reader';
import { GrowthNotesManager } from './growth-notes.manager';
import { GrowthNotesRepository } from './growth-notes.repository';

@Module({
  controllers: [GrowthNotesController],
  providers: [GrowthNotesService, GrowthNotesReader, GrowthNotesManager, GrowthNotesRepository],
})
export class GrowthNotesModule {}
