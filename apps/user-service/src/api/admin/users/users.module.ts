import { Module } from '@nestjs/common';
import { AdminRolesModule } from '../roles/roles.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AdminRolesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class AdminUserModule {}
