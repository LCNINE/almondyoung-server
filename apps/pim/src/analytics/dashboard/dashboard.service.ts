import { Injectable } from '@nestjs/common';
import { eq, and, gte, lte, sql, isNull } from 'drizzle-orm';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { pimSchema, productMasters } from '../../schema';
import {
  DashboardMetricsResponseDto,
  StatusBreakdownDto,
  ApprovalBreakdownDto,
  TopProductItemDto,
  SalesTrendResponseDto,
} from './dto';

@Injectable()
export class DashboardService {
  constructor(
    @InjectTypedDb<typeof pimSchema>()
    private readonly dbService: DbService<typeof pimSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 대시보드 메트릭 조회
   * - 전체 제품 수
   * - 오늘 등록된 제품 수
   * - 상태별 제품 수
   * - 승인 상태별 제품 수
   * - 재고 부족 제품 수 (향후 WMS 연동)
   */
  async getMetrics(): Promise<DashboardMetricsResponseDto> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    // 1. 전체 제품 수 (소프트 삭제 제외)
    const [{ totalProducts }] = await this.db
      .select({ totalProducts: sql<number>`count(*)` })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt));

    // 2. 상태별 제품 수
    const productsByStatus = await this.db
      .select({
        status: productMasters.status,
        count: sql<number>`count(*)`,
      })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt))
      .groupBy(productMasters.status);

    // 3. 승인 상태별 제품 수
    const productsByApproval = await this.db
      .select({
        approvalStatus: productMasters.approvalStatus,
        count: sql<number>`count(*)`,
      })
      .from(productMasters)
      .where(isNull(productMasters.deletedAt))
      .groupBy(productMasters.approvalStatus);

    // 4. 오늘 등록된 제품 수
    const [{ createdToday }] = await this.db
      .select({ createdToday: sql<number>`count(*)` })
      .from(productMasters)
      .where(
        and(
          isNull(productMasters.deletedAt),
          gte(productMasters.createdAt, todayStart),
        ),
      );

    // 5. 재고 부족 제품 수 (향후 WMS 연동 시 구현)
    // TODO: WMS 서비스와 연동하여 실제 재고 데이터 가져오기
    const outOfStock = 0;

    // 결과 매핑
    const byStatus: StatusBreakdownDto[] = productsByStatus.map((s) => ({
      status: s.status || 'unknown',
      count: Number(s.count),
    }));

    const byApproval: ApprovalBreakdownDto[] = productsByApproval.map((a) => ({
      approvalStatus: a.approvalStatus || 'unknown',
      count: Number(a.count),
    }));

    return {
      totalProducts: Number(totalProducts),
      createdToday: Number(createdToday),
      outOfStock,
      byStatus,
      byApproval,
    };
  }

  /**
   * 상위 제품 목록 조회
   * - 활성화된 제품 중 최근 등록순으로 조회
   * - 향후 주문 서비스 연동 시 실제 판매량 기준으로 변경 가능
   * 
   * @param limit 조회할 제품 수 (기본값: 5)
   */
  async getTopProducts(limit = 5): Promise<TopProductItemDto[]> {
    const products = await this.db
      .select({
        id: productMasters.id,
        name: productMasters.name,
        brand: productMasters.brand,
        basePrice: productMasters.basePrice,
        status: productMasters.status,
        approvalStatus: productMasters.approvalStatus,
        createdAt: productMasters.createdAt,
      })
      .from(productMasters)
      .where(
        and(
          isNull(productMasters.deletedAt),
          eq(productMasters.status, 'active'),
        ),
      )
      .orderBy(productMasters.createdAt) // 최근 등록순
      .limit(limit);

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      basePrice: p.basePrice || 0,
      status: p.status || 'unknown',
      approvalStatus: p.approvalStatus || 'unknown',
      createdAt: p.createdAt || new Date(),
    }));
  }

  /**
   * 매출 트렌드 조회
   * - 향후 주문 서비스 연동 시 구현
   * - 현재는 구조만 반환
   * 
   * @param days 조회할 기간 (일 단위, 기본값: 30)
   */
  async getSalesTrends(days = 30): Promise<SalesTrendResponseDto> {
    // TODO: 주문 서비스와 연동하여 실제 매출 데이터 가져오기
    // const endDate = new Date();
    // const startDate = new Date();
    // startDate.setDate(startDate.getDate() - days);
    // 
    // const salesData = await this.orderClient.getSalesByDateRange({
    //   startDate,
    //   endDate,
    // });
    // 
    // return {
    //   labels: salesData.map(d => d.date),
    //   data: salesData.map(d => d.totalAmount),
    // };

    // 플레이스홀더 반환
    return {
      labels: [],
      data: [],
    };
  }
}

