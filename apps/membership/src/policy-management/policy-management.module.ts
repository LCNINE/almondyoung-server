import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { PolicyManagementService } from './policy-management.service';
import { PolicyEngineService } from './policy-engine.service';
import { PolicyManagementController } from './policy-management.controller';
import { PolicyValidationController } from './policy-validation.controller';

@Module({
  imports: [DbModule],
  controllers: [PolicyManagementController, PolicyValidationController],
  providers: [PolicyManagementService, PolicyEngineService],
  exports: [PolicyManagementService, PolicyEngineService],
})
export class PolicyManagementModule {}