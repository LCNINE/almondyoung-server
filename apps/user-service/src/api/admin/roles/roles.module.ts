import { Module } from '@nestjs/common';
import { UsersModule } from '../../users/users.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [UsersModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class AdminRolesModule {}
