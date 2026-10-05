import { Module } from '@nestjs/common';
import { OrderProgressController } from './order-progress.controller';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import { OrderProgressRefreshJob } from './order-progress.refresh.job';
import { OrderProgressService } from './order-progress.service';

/**
 * 정체 보드 — 주문 진행 투영(스펙 docs/superpowers/specs/2026-10-06-order-stall-board-design.md).
 * 원천 모듈을 import 하지 않는다: 판정은 원천 테이블을 SQL 로 읽기만 한다. DbModule 은 전역.
 * 리컨실러는 OrderProgressReader 를 export 받아 쓴다.
 */
@Module({
  controllers: [OrderProgressController],
  providers: [OrderProgressReader, OrderProgressManager, OrderProgressRefreshJob, OrderProgressService],
  exports: [OrderProgressReader],
})
export class OrderProgressModule {}
