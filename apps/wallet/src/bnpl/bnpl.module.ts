import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';
import { BnplAccountService } from './services/bnpl-account.service';
import { BnplListener } from './listeners/bnpl.listener';

@Module({
  imports: [SharedModule],
  controllers: [], // ✅ 컨트롤러를 완전히 제거합니다.
  providers: [
    BnplAccountService, // BNPL 계정 생성 서비스
    BnplListener, // 이벤트 리스너
  ],
  exports: [BnplAccountService], // 다른 모듈에서 필요하면 서비스를 export 할 수 있습니다.
})
export class BnplModule {}
