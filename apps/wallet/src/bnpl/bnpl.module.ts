import { Module } from '@nestjs/common';
import { SharedModule } from '@app/shared';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [
    // 어댑터/포트 DI는 pg-provider.module.ts에서 처리
  ],
  exports: [],
})
export class BnplModule {}
