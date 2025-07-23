import { Module } from '@nestjs/common';
import { PointService } from './point.service';
import { PointController } from './point.controller';
import { PointListener } from './listeners/point.listener';

/**
 * 포인트(Point) 모듈 - Medusa.js 스타일 상태+로그 모델 적용
 * - PointService: 포인트 적립/사용/조회 등 핵심 비즈니스 로직
 * - PointController: 사용자 포인트 조회 API
 * - PointListener: 다른 모듈 이벤트 수신 및 포인트 자동 처리
 *
 * 핵심 특징:
 * - 빠른 조회: points 테이블에서 현재 잔액 즉시 조회
 * - 완벽한 추적: pointTransactions 테이블에 모든 변동 내역 기록
 * - 이벤트 기반 연동: 결제/환불 완료 시 자동 포인트 적립/회수
 */
@Module({
  providers: [PointService, PointListener],
  controllers: [PointController],
  exports: [PointService],
})
export class PointModule {}
