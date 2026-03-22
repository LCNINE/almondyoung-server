import { Module } from '@nestjs/common';
import { RoleScopeController } from './role-scope.controller';
import { RoleScopeService } from './role-scope.service';
import { ScopeReader } from './scope.reader';

@Module({
  controllers: [RoleScopeController],
  providers: [RoleScopeService, ScopeReader],
})
export class RoleScopeApiModule {}
