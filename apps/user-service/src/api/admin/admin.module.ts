import { RolesModule } from '@app/roles';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

@Module({
  imports: [AuthModule, RolesModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class AdminModule {}
