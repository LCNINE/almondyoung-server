import { Controller, Get, Post, Body, Param, Query, UsePipes } from '@nestjs/common';
import { ConsolidationService } from '../../shared/services/consolidation.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const AutoConsolidateSchema = z.object({
  groupId: z.string()
});

const FindCandidatesSchema = z.object({
  warehouseId: z.string().uuid()
});

@Controller('consolidation')
export class ConsolidationController {
  constructor(
    private readonly consolidationService: ConsolidationService
  ) {}

  @Get('candidates/:warehouseId')
  async findConsolidationCandidates(@Param('warehouseId') warehouseId: string) {
    return this.consolidationService.findConsolidationCandidates(warehouseId);
  }

  @Post('candidates/:warehouseId/analyze')
  async analyzeConsolidationOpportunities(@Param('warehouseId') warehouseId: string) {
    const candidates = await this.consolidationService.findConsolidationCandidates(warehouseId);
    const groups = await this.consolidationService.generateConsolidationGroups(candidates);

    return {
      warehouseId,
      analyzedAt: new Date(),
      summary: {
        totalCandidates: candidates.length,
        groupsFound: groups.length,
        autoConsolidateRecommended: groups.filter(g => g.recommendation === 'auto_consolidate').length,
        manualReviewRequired: groups.filter(g => g.recommendation === 'manual_review').length,
        estimatedTotalSavings: groups.reduce((sum, g) =>
          sum + g.estimatedSavings.shippingCost + g.estimatedSavings.packagingReduction + g.estimatedSavings.efficiencyGain, 0
        )
      },
      groups
    };
  }

  @Post('groups/:groupId/auto-consolidate')
  @UsePipes(new ZodValidationPipe(AutoConsolidateSchema))
  async autoConsolidate(@Param('groupId') groupId: string) {
    const result = await this.consolidationService.autoConsolidate(groupId);
    return {
      message: 'Auto-consolidation completed successfully',
      ...result
    };
  }

  @Get('reports/:warehouseId')
  async getConsolidationReport(
    @Param('warehouseId') warehouseId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string
  ) {
    return this.consolidationService.getConsolidationReport(
      warehouseId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined
    );
  }

  @Get('rules')
  async getConsolidationRules() {
    return {
      rules: [
        {
          id: 'same-address-same-customer',
          name: '동일 고객 동일 주소',
          description: '같은 고객의 같은 배송지 주문을 자동으로 합배송',
          enabled: true,
          priority: 1,
          autoConsolidate: true,
          criteria: {
            addressMatch: 'exact',
            customerMatch: true,
            serviceMatch: true,
            timeWindow: 24
          },
          constraints: {
            maxOrdersPerGroup: 5,
            maxTotalWeight: 30,
            maxTotalValue: 1000000
          }
        },
        {
          id: 'same-address-different-customer',
          name: '동일 주소 다른 고객',
          description: '같은 배송지의 다른 고객 주문을 검토 후 합배송',
          enabled: true,
          priority: 2,
          autoConsolidate: false,
          criteria: {
            addressMatch: 'exact',
            customerMatch: false,
            serviceMatch: true,
            timeWindow: 12
          },
          constraints: {
            maxOrdersPerGroup: 3,
            maxTotalWeight: 20,
            maxTotalValue: 500000
          }
        },
        {
          id: 'nearby-same-customer',
          name: '동일 고객 인근 주소',
          description: '같은 고객의 인근 배송지 주문을 검토 후 합배송',
          enabled: true,
          priority: 3,
          autoConsolidate: false,
          criteria: {
            addressMatch: 'fuzzy',
            customerMatch: true,
            serviceMatch: true,
            timeWindow: 48,
            maxDistance: 5
          },
          constraints: {
            maxOrdersPerGroup: 3,
            maxTotalWeight: 25,
            maxTotalValue: 800000
          }
        }
      ]
    };
  }

  @Get('opportunities/live/:warehouseId')
  async getLiveConsolidationOpportunities(@Param('warehouseId') warehouseId: string) {
    const candidates = await this.consolidationService.findConsolidationCandidates(warehouseId);
    const groups = await this.consolidationService.generateConsolidationGroups(candidates);

    const autoConsolidateGroups = groups.filter(g => g.recommendation === 'auto_consolidate');
    const manualReviewGroups = groups.filter(g => g.recommendation === 'manual_review');

    return {
      warehouseId,
      timestamp: new Date(),
      opportunities: {
        immediate: {
          count: autoConsolidateGroups.length,
          potentialSavings: autoConsolidateGroups.reduce((sum, g) =>
            sum + g.estimatedSavings.shippingCost + g.estimatedSavings.packagingReduction + g.estimatedSavings.efficiencyGain, 0
          ),
          groups: autoConsolidateGroups.slice(0, 5) // Top 5 for preview
        },
        reviewRequired: {
          count: manualReviewGroups.length,
          potentialSavings: manualReviewGroups.reduce((sum, g) =>
            sum + g.estimatedSavings.shippingCost + g.estimatedSavings.packagingReduction + g.estimatedSavings.efficiencyGain, 0
          ),
          groups: manualReviewGroups.slice(0, 5) // Top 5 for preview
        }
      },
      recommendations: this.generateRecommendations(groups)
    };
  }

  @Get('savings/projection/:warehouseId')
  async getSavingsProjection(
    @Param('warehouseId') warehouseId: string,
    @Query('days') days: number = 30
  ) {
    const candidates = await this.consolidationService.findConsolidationCandidates(warehouseId);
    const groups = await this.consolidationService.generateConsolidationGroups(candidates);

    const dailyAvgSavings = groups.reduce((sum, g) =>
      sum + g.estimatedSavings.shippingCost + g.estimatedSavings.packagingReduction + g.estimatedSavings.efficiencyGain, 0
    );

    const projectedSavings = dailyAvgSavings * days;
    const consolidationRate = candidates.length > 0 ? (groups.length * 2) / candidates.length : 0;

    return {
      warehouseId,
      projectionPeriod: { days },
      currentOpportunities: {
        candidateOrders: candidates.length,
        consolidationGroups: groups.length,
        consolidationRate: Math.round(consolidationRate * 100),
        dailySavings: Math.round(dailyAvgSavings)
      },
      projection: {
        totalSavings: Math.round(projectedSavings),
        shippingCostSavings: Math.round(projectedSavings * 0.6),
        packagingSavings: Math.round(projectedSavings * 0.2),
        efficiencyGains: Math.round(projectedSavings * 0.2),
        carbonFootprintReduction: Math.round(groups.length * 0.5) // kg CO2 saved per day
      },
      breakdown: {
        autoConsolidation: Math.round(projectedSavings * 0.7),
        manualReview: Math.round(projectedSavings * 0.3)
      }
    };
  }

  private generateRecommendations(groups: any[]): string[] {
    const recommendations: string[] = [];

    const autoGroups = groups.filter(g => g.recommendation === 'auto_consolidate').length;
    const manualGroups = groups.filter(g => g.recommendation === 'manual_review').length;

    if (autoGroups > 0) {
      recommendations.push(`${autoGroups}개의 주문 그룹을 즉시 자동 합배송할 수 있습니다`);
    }

    if (manualGroups > 0) {
      recommendations.push(`${manualGroups}개의 주문 그룹이 수동 검토를 통한 합배송 가능합니다`);
    }

    if (groups.length === 0) {
      recommendations.push('현재 합배송 가능한 주문이 없습니다');
    }

    // Add operational recommendations
    const highValueGroups = groups.filter(g =>
      g.estimatedSavings.shippingCost + g.estimatedSavings.packagingReduction + g.estimatedSavings.efficiencyGain > 10000
    ).length;

    if (highValueGroups > 0) {
      recommendations.push(`고효율 합배송 기회 ${highValueGroups}건이 발견되었습니다`);
    }

    return recommendations;
  }
}