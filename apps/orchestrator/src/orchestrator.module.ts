import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { validateOrchestratorEnv } from './config/env.validation';
import { WorkflowController } from './controllers/workflow.controller';
import { UnifiedMasterWorkflow } from './workflows/unified-master.workflow';
import { PimApiService } from './services/pim.api.service';
import { WmsApiService } from './services/wms.api.service';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateOrchestratorEnv,
      envFilePath: 'apps/orchestrator/.env',
    }),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
  ],
  controllers: [WorkflowController],
  providers: [UnifiedMasterWorkflow, PimApiService, WmsApiService],
})
export class OrchestratorModule {}
