import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { MetricsService } from './metrics.service';

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    [key: string]: {
      status: 'healthy' | 'unhealthy';
      responseTime: number;
      details?: any;
      error?: string;
    };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly metrics?: MetricsService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 기본 헬스체크
   */
  async checkHealth(): Promise<{ status: string; timestamp: string; uptime: number }> {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * 레디니스 체크 (의존성 확인)
   */
  async checkReadiness(): Promise<{ status: string; ready: boolean }> {
    try {
      // 데이터베이스 연결 확인
      await this.checkDatabase();

      return {
        status: 'ready',
        ready: true,
      };
    } catch (error) {
      return {
        status: 'not ready',
        ready: false,
      };
    }
  }

  /**
   * 라이브니스 체크 (프로세스 상태 확인)
   */
  async checkLiveness(): Promise<{ status: string; alive: boolean }> {
    // 간단한 메모리 사용량 확인
    const memUsage = process.memoryUsage();
    const maxHeapSize = memUsage.heapTotal * 0.9; // 90% 임계치

    const alive = memUsage.heapUsed < maxHeapSize;

    return {
      status: alive ? 'alive' : 'unhealthy',
      alive,
    };
  }

  /**
   * 상세 헬스체크
   */
  async getDetailedHealth(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let overallStatus: 'healthy' | 'unhealthy' = 'healthy';

    // 데이터베이스 체크
    try {
      const dbResult = await this.checkDatabase();
      checks.database = dbResult;
      this.metrics?.recordHealthCheck('database', dbResult.status, dbResult.responseTime);
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        responseTime: 0,
        error: error.message,
      };
      overallStatus = 'unhealthy';
    }

    // 메모리 체크
    try {
      const memoryResult = await this.checkMemory();
      checks.memory = memoryResult;
      this.metrics?.recordHealthCheck('memory', memoryResult.status, memoryResult.responseTime);
    } catch (error) {
      checks.memory = {
        status: 'unhealthy',
        responseTime: 0,
        error: error.message,
      };
      overallStatus = 'unhealthy';
    }

    // 비즈니스 로직 체크
    try {
      const businessResult = await this.checkBusinessLogic();
      checks.business = businessResult;
      this.metrics?.recordHealthCheck('business', businessResult.status, businessResult.responseTime);
    } catch (error) {
      checks.business = {
        status: 'unhealthy',
        responseTime: 0,
        error: error.message,
      };
      overallStatus = 'unhealthy';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      checks,
    };
  }

  /**
   * 데이터베이스 헬스체크
   */
  private async checkDatabase(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; details?: any }> {
    const startTime = Date.now();

    try {
      // 간단한 쿼리 실행
      const result = await this.db.select().from(wmsTables.warehouses).limit(1);
      const responseTime = Date.now() - startTime;

      if (responseTime > 5000) {
        // 5초 이상 걸리면 느린 것으로 판단
        return {
          status: 'unhealthy',
          responseTime,
          details: { reason: 'slow_response', threshold: 5000 },
        };
      }

      return {
        status: 'healthy',
        responseTime,
        details: { connection: 'ok', queryTime: responseTime },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      throw new Error(`Database health check failed: ${error.message}`);
    }
  }

  /**
   * 메모리 헬스체크
   */
  private async checkMemory(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; details?: any }> {
    const startTime = Date.now();

    const memUsage = process.memoryUsage();
    const responseTime = Date.now() - startTime;

    // 메모리 사용량 임계치 (90%)
    const memoryThreshold = 0.9;
    const heapUsedRatio = memUsage.heapUsed / memUsage.heapTotal;

    const status = heapUsedRatio < memoryThreshold ? 'healthy' : 'unhealthy';

    return {
      status,
      responseTime,
      details: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        heapUsedRatio: Math.round(heapUsedRatio * 100) / 100,
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      },
    };
  }

  /**
   * 비즈니스 로직 헬스체크
   */
  private async checkBusinessLogic(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime: number; details?: any }> {
    const startTime = Date.now();

    try {
      // 기본 테이블들이 존재하는지 확인
      const [warehouseCount] = await this.db.select().from(wmsTables.warehouses);
      const [skuCount] = await this.db.select().from(wmsTables.skus).limit(1);

      const responseTime = Date.now() - startTime;

      if (responseTime > 3000) {
        return {
          status: 'unhealthy',
          responseTime,
          details: { reason: 'slow_business_logic', threshold: 3000 },
        };
      }

      return {
        status: 'healthy',
        responseTime,
        details: {
          tablesAccessible: true,
          queryTime: responseTime,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      throw new Error(`Business logic health check failed: ${error.message}`);
    }
  }

  /**
   * 특정 컴포넌트의 헬스 상태 확인
   */
  async checkComponent(componentName: string): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }> {
    switch (componentName) {
      case 'inventory':
        return this.checkInventoryService();
      case 'orders':
        return this.checkOrderService();
      case 'reservations':
        return this.checkReservationService();
      default:
        return { status: 'unhealthy', details: { error: 'Unknown component' } };
    }
  }

  private async checkInventoryService(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }> {
    try {
      // 재고 테이블 기본 조회
      const result = await this.db.select().from(wmsTables.stockSummary).limit(1);
      return { status: 'healthy', details: { service: 'inventory', accessible: true } };
    } catch (error) {
      return { status: 'unhealthy', details: { service: 'inventory', error: error.message } };
    }
  }

  private async checkOrderService(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }> {
    try {
      // 주문 테이블 기본 조회
      const result = await this.db.select().from(wmsTables.salesOrders).limit(1);
      return { status: 'healthy', details: { service: 'orders', accessible: true } };
    } catch (error) {
      return { status: 'unhealthy', details: { service: 'orders', error: error.message } };
    }
  }

  private async checkReservationService(): Promise<{ status: 'healthy' | 'unhealthy'; details?: any }> {
    try {
      // 예약 테이블 기본 조회
      const result = await this.db.select().from(wmsTables.stockReservations).limit(1);
      return { status: 'healthy', details: { service: 'reservations', accessible: true } };
    } catch (error) {
      return { status: 'unhealthy', details: { service: 'reservations', error: error.message } };
    }
  }
}