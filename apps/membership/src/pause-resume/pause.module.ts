import { Module } from '@nestjs/common';
import { PauseService } from './pause.service';
import { PauseController } from './pause.controller';
import { PolicyManagementModule } from '../policy-management/policy-management.module';

/**
 * 일시정지 관리 모듈
 */
@Module({
  // PolicyGuard가 PolicyService를 사용하므로 PolicyManagementModule을 import합니다.
  imports: [PolicyManagementModule],
  controllers: [PauseController],
  providers: [PauseService],
  exports: [PauseService],
})
export class PauseModule {}
