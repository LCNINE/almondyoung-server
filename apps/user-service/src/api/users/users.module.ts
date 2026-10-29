import { EventsModule } from '@app/events';
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRolesReader } from './user-roles.reader';
import { WithdrawnReplayService } from './withdrawn-replay.service';

@Module({
  imports: [EventsModule],
  controllers: [UsersController],
  providers: [UsersService, UserRolesReader, WithdrawnReplayService],
  exports: [UsersService],
})
export class UsersModule {}
