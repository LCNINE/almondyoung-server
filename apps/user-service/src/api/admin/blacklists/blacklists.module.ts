import { Module } from '@nestjs/common';
import { BlacklistsController } from './blacklists.controller';
import { BlacklistsService } from './blacklists.service';

@Module({
  controllers: [BlacklistsController],
  providers: [BlacklistsService],
  exports: [BlacklistsService],
})
export class BlacklistsModule {}
