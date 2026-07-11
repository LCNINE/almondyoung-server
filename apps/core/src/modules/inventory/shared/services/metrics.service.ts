import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  // 주문 관련 메트릭
  private readonly orderCounter = new Counter({
    name: 'wms_orders_total',
    help: 'Total number of orders processed',
    labelNames: ['status', 'channel', 'fulfillment_mode'],
    registers: [register],
  });

  private readonly orderProcessingDuration = new Histogram({
    name: 'wms_order_processing_duration_seconds',
    help: 'Time taken to process orders',
    labelNames: ['operation'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [register],
  });

  // 재고 관련 메트릭
  private readonly stockReservationCounter = new Counter({
    name: 'wms_stock_reservations_total',
    help: 'Total number of stock reservations',
    labelNames: ['status', 'warehouse'],
    registers: [register],
  });

  private readonly stockReservationDuration = new Histogram({
    name: 'wms_stock_reservation_duration_seconds',
    help: 'Time taken for stock reservations',
    buckets: [0.01, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  private readonly optimisticLockRetries = new Counter({
    name: 'wms_optimistic_lock_retries_total',
    help: 'Total number of optimistic lock retries',
    labelNames: ['operation'],
    registers: [register],
  });

  private readonly availableStock = new Gauge({
    name: 'wms_available_stock',
    help: 'Available stock quantity by SKU and warehouse',
    labelNames: ['sku_id', 'warehouse_id'],
    registers: [register],
  });

  // 시스템 메트릭
  private readonly errorCounter = new Counter({
    name: 'wms_errors_total',
    help: 'Total number of errors by module',
    labelNames: ['module', 'error_type', 'severity'],
    registers: [register],
  });

  private readonly businessOperationsCounter = new Counter({
    name: 'wms_business_operations_total',
    help: 'Total number of business operations',
    labelNames: ['module', 'operation', 'status'],
    registers: [register],
  });

  // 성능 메트릭
  private readonly databaseQueryDuration = new Histogram({
    name: 'wms_database_query_duration_seconds',
    help: 'Database query execution time',
    labelNames: ['operation'],
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  // 헬스체크 메트릭 — 다른 메트릭과 동일하게 한 번만 등록. recordHealthCheck() 안에서
  // 매번 생성하면 두 번째 호출부터 prom-client 중복 등록 예외가 난다.
  private readonly healthGauge = new Gauge({
    name: 'wms_health_status',
    help: 'Health status of WMS components',
    labelNames: ['component'],
    registers: [register],
  });

  private readonly healthResponseTime = new Histogram({
    name: 'wms_health_response_time_seconds',
    help: 'Response time for health checks',
    labelNames: ['component'],
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  // 원장 대사 메트릭 — stock_ledgers 와 이벤트 파생 수량의 불일치 grain 수.
  // setLedgerDrift 가 매 대사 실행 후 두 severity 라벨을 항상 set 한다(정상 시 0).
  private readonly ledgerDriftGauge = new Gauge({
    name: 'wms_ledger_drift_grains',
    help: 'Number of stock ledger grains whose qty disagrees with the event-derived quantity',
    labelNames: ['severity'],
    registers: [register],
  });

  // 예약 불변식 대사 메트릭 — (sku,warehouse) 의 confirmed 예약 합이 ON_HAND 원장 합을 초과하는 grain 수.
  private readonly reservedOverOnHandGauge = new Gauge({
    name: 'wms_reserved_over_onhand_grains',
    help: 'Number of (sku,warehouse) grains whose confirmed reservations exceed ON_HAND',
    registers: [register],
  });

  // 좀비 예약 대사 메트릭 — terminal FO 인데 confirmed 로 남은 예약 행 수(직전 대사 heal 전 탐지값).
  private readonly zombieReservationsGauge = new Gauge({
    name: 'wms_zombie_reservations_grains',
    help: 'Number of confirmed reservations still attached to terminal fulfillment orders (last reconcile, pre-heal)',
    registers: [register],
  });

  private readonly zombieReservationsHealedCounter = new Counter({
    name: 'wms_zombie_reservations_healed_total',
    help: 'Cumulative number of zombie reservations released by reconciliation',
    registers: [register],
  });

  onModuleInit() {
    // 기본 시스템 메트릭 수집 시작
    collectDefaultMetrics({ register });
    this.logger.log('Metrics collection initialized');
  }

  /**
   * 주문 메트릭 증가
   */
  incrementOrderCounter(status: string, channel: string, fulfillmentMode?: string) {
    this.orderCounter.inc({
      status,
      channel,
      fulfillment_mode: fulfillmentMode || 'unknown',
    });
  }

  /**
   * 주문 처리 시간 기록
   */
  recordOrderProcessingTime(operation: string, durationSeconds: number) {
    this.orderProcessingDuration.observe({ operation }, durationSeconds);
  }

  /**
   * 주문 처리 시간 측정을 위한 타이머 시작
   */
  startOrderTimer(operation: string) {
    return this.orderProcessingDuration.startTimer({ operation });
  }

  /**
   * 재고 예약 메트릭 증가
   */
  incrementStockReservationCounter(status: 'success' | 'failure' | 'retry', warehouse: string) {
    this.stockReservationCounter.inc({ status, warehouse });
  }

  /**
   * 재고 예약 시간 기록
   */
  recordStockReservationTime(durationSeconds: number) {
    this.stockReservationDuration.observe(durationSeconds);
  }

  /**
   * 재고 예약 타이머 시작
   */
  startStockReservationTimer() {
    return this.stockReservationDuration.startTimer();
  }

  /**
   * 낙관적 잠금 재시도 횟수 기록
   */
  incrementOptimisticLockRetries(operation: string) {
    this.optimisticLockRetries.inc({ operation });
  }

  /**
   * 가용 재고 수량 업데이트
   */
  setAvailableStock(skuId: string, warehouseId: string, quantity: number) {
    this.availableStock.set({ sku_id: skuId, warehouse_id: warehouseId }, quantity);
  }

  /**
   * 에러 메트릭 증가
   */
  incrementErrorCounter(module: string, errorType: string, severity: 'low' | 'medium' | 'high' | 'critical') {
    this.errorCounter.inc({ module, error_type: errorType, severity });
  }

  /**
   * 비즈니스 오퍼레이션 메트릭 증가
   */
  incrementBusinessOperation(module: string, operation: string, status: 'success' | 'failure') {
    this.businessOperationsCounter.inc({ module, operation, status });
  }

  /**
   * 데이터베이스 쿼리 시간 기록
   */
  recordDatabaseQueryTime(operation: string, durationSeconds: number) {
    this.databaseQueryDuration.observe({ operation }, durationSeconds);
  }

  /**
   * 데이터베이스 쿼리 타이머 시작
   */
  startDatabaseTimer(operation: string) {
    return this.databaseQueryDuration.startTimer({ operation });
  }

  /**
   * 모든 메트릭 조회 (Prometheus 엔드포인트용)
   */
  async getMetrics(): Promise<string> {
    return await register.metrics();
  }

  /**
   * 특정 메트릭 초기화 (테스트용)
   */
  reset() {
    register.resetMetrics();
    this.logger.warn('Metrics have been reset');
  }

  /**
   * 비즈니스 메트릭 업데이트 (배치 작업용)
   */
  updateBusinessMetrics() {
    try {
      // 이 메소드는 주기적으로 호출되어 비즈니스 메트릭을 업데이트할 수 있습니다.
      // 예: 총 주문 수, 평균 재고 회전율 등

      this.logger.debug('Business metrics updated');
    } catch (error) {
      this.logger.error('Failed to update business metrics:', error);
      this.incrementErrorCounter('metrics', 'business_update_failed', 'medium');
    }
  }

  /**
   * 헬스체크용 메트릭
   */
  recordHealthCheck(component: string, status: 'healthy' | 'unhealthy', responseTimeMs: number) {
    this.healthGauge.set({ component }, status === 'healthy' ? 1 : 0);
    this.healthResponseTime.observe({ component }, responseTimeMs / 1000);
  }

  /**
   * 원장 대사 결과 기록 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다.
   */
  setLedgerDrift(counts: { mismatch: number; critical: number }) {
    this.ledgerDriftGauge.set({ severity: 'MISMATCH' }, counts.mismatch);
    this.ledgerDriftGauge.set({ severity: 'CRITICAL' }, counts.critical);
  }

  /** 예약 초과 grain 수 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다. */
  setReservedOverOnHand(count: number) {
    this.reservedOverOnHandGauge.set(count);
  }

  /** 직전 좀비 대사에서 탐지된 예약 행 수 — 정상 실행도 0 을 써서 이전 값 잔존을 막는다. */
  setZombieReservations(count: number) {
    this.zombieReservationsGauge.set(count);
  }

  /** 대사로 release 한 좀비 예약 누적 수. */
  incZombieReservationsHealed(count: number) {
    if (count > 0) this.zombieReservationsHealedCounter.inc(count);
  }

  /**
   * 커스텀 메트릭 생성
   */
  createCustomCounter(name: string, help: string, labelNames?: string[]) {
    return new Counter({
      name: `wms_${name}`,
      help,
      labelNames: labelNames || [],
      registers: [register],
    });
  }

  createCustomHistogram(name: string, help: string, labelNames?: string[], buckets?: number[]) {
    return new Histogram({
      name: `wms_${name}`,
      help,
      labelNames: labelNames || [],
      buckets: buckets || [0.1, 0.5, 1, 2, 5, 10],
      registers: [register],
    });
  }

  createCustomGauge(name: string, help: string, labelNames?: string[]) {
    return new Gauge({
      name: `wms_${name}`,
      help,
      labelNames: labelNames || [],
      registers: [register],
    });
  }
}
