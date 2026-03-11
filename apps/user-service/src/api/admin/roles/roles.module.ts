import { Module } from '@nestjs/common';
import { UsersModule } from '../../users/users.module';
import { RolesController } from './roles.controller';
import { RolesManager } from './roles.manager';
import { RolesReader } from './roles.reader';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

@Module({
  imports: [UsersModule],
  controllers: [RolesController],
  providers: [RolesService, RolesReader, RolesManager, RolesRepository],
  exports: [RolesService],
})
export class AdminRolesModule {}
