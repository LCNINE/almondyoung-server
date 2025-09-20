import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../../../database/schemas/wms-schema';
import { TypedDatabase, DbService } from '@app/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { FulfillmentOrderTransactionService } from './fulfillment-order-transaction.service';

export interface ConsolidationCandidate {
  salesOrderId: string;
  customerId: string;
  customerName: string;
  shippingAddress: {
    recipientName: string;
    address: string;
    city: string;
    postalCode: string;
    phone: string;
  };
  deliveryService: string;
  priority: 'normal' | 'high' | 'urgent';
  slaDeadline: Date;
  totalItems: number;
  totalWeight?: number;
  totalValue?: number;
  items: Array<{
    salesOrderLineId: string;
    productId: string;
    variantId: string;
    qty: number;
    weight?: number;
    dimensions?: {
      length: number;
      width: number;
      height: number;
    };
  }>;
  warehouseId: string;
  createdAt: Date;
}

export interface ConsolidationGroup {
  groupId: string;
  consolidationKey: string;
  reason: 'same_address' | 'same_customer_nearby' | 'same_service_zone' | 'manual';
  confidence: number;
  salesOrders: ConsolidationCandidate[];
  estimatedSavings: {
    shippingCost: number;
    packagingReduction: number;
    efficiencyGain: number;
  };
  constraints: {
    maxWeight: number;
    maxVolume: number;
    maxItems: number;
    slaDeadline: Date;
  };
  recommendation: 'auto_consolidate' | 'manual_review' | 'skip';
}

export interface ConsolidationRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  criteria: {
    addressMatch: 'exact' | 'fuzzy' | 'postal_code' | 'city';
    customerMatch: boolean;
    serviceMatch: boolean;
    timeWindow: number; // hours
    maxDistance?: number; // km for nearby addresses
    maxWeightDifference?: number; // kg
    maxSlaDelay?: number; // hours
  };
  constraints: {
    maxOrdersPerGroup: number;
    maxTotalWeight: number;
    maxTotalVolume: number;
    maxTotalValue: number;
    requireSamePriority: boolean;
  };
  actions: {
    autoConsolidate: boolean;
    notifyForReview: boolean;
    applyShippingDiscount: boolean;
  };
}

@Injectable()
export class ConsolidationService {
  private readonly logger = new Logger(ConsolidationService.name);

  // Default consolidation rules
  private readonly defaultRules: ConsolidationRule[] = [
    {
      id: 'same-address-same-customer',
      name: '동일 고객 동일 주소',
      enabled: true,
      priority: 1,
      criteria: {
        addressMatch: 'exact',
        customerMatch: true,
        serviceMatch: true,
        timeWindow: 24
      },
      constraints: {
        maxOrdersPerGroup: 5,
        maxTotalWeight: 30,
        maxTotalVolume: 0.1, // m³
        maxTotalValue: 1000000,
        requireSamePriority: false
      },
      actions: {
        autoConsolidate: true,
        notifyForReview: false,
        applyShippingDiscount: true
      }
    },
    {
      id: 'same-address-different-customer',
      name: '동일 주소 다른 고객',
      enabled: true,
      priority: 2,
      criteria: {
        addressMatch: 'exact',
        customerMatch: false,
        serviceMatch: true,
        timeWindow: 12
      },
      constraints: {
        maxOrdersPerGroup: 3,
        maxTotalWeight: 20,
        maxTotalVolume: 0.05,
        maxTotalValue: 500000,
        requireSamePriority: true
      },
      actions: {
        autoConsolidate: false,
        notifyForReview: true,
        applyShippingDiscount: false
      }
    },
    {
      id: 'nearby-same-customer',
      name: '동일 고객 인근 주소',
      enabled: true,
      priority: 3,
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
        maxTotalVolume: 0.08,
        maxTotalValue: 800000,
        requireSamePriority: false
      },
      actions: {
        autoConsolidate: false,
        notifyForReview: true,
        applyShippingDiscount: true
      }
    }
  ];

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly dbService: DbService<typeof wmsTables>,
    private readonly fulfillmentOrderTransactionService: FulfillmentOrderTransactionService
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async findConsolidationCandidates(warehouseId: string): Promise<ConsolidationCandidate[]> {
    // Find pending sales orders that haven't been fulfilled yet
    const fulfillmentOrders = await this.db.query.fulfillmentOrders.findMany({
      where: and(
        eq(wmsTables.fulfillmentOrders.warehouseId, warehouseId),
        eq(wmsTables.fulfillmentOrders.status, 'pending'),
        isNull(wmsTables.fulfillmentOrders.batchId),
        eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'in_house') // Exclude direct ship
      ),
      with: {
        items: true
      }
    });

    const candidates: ConsolidationCandidate[] = [];

    for (const fo of fulfillmentOrders) {
      if (fo.items.length === 0) continue;

      // Group items by sales order
      const salesOrderGroups = new Map<string, typeof fo.items>();

      for (const item of fo.items) {
        const soId = item.salesOrderId;
        if (!salesOrderGroups.has(soId)) {
          salesOrderGroups.set(soId, []);
        }
        salesOrderGroups.get(soId)!.push(item);
      }

      for (const [salesOrderId, items] of salesOrderGroups) {
        // TODO: Get actual customer and shipping info from sales order
        // For now, generate mock data
        const candidate: ConsolidationCandidate = {
          salesOrderId,
          customerId: `CUST-${salesOrderId.slice(-6)}`,
          customerName: `Customer ${salesOrderId.slice(-3)}`,
          shippingAddress: {
            recipientName: `Customer ${salesOrderId.slice(-3)}`,
            address: `${Math.floor(Math.random() * 999) + 1} Test Street`,
            city: ['서울', '부산', '인천', '대구', '광주'][Math.floor(Math.random() * 5)],
            postalCode: `${Math.floor(Math.random() * 90000) + 10000}`,
            phone: '010-1234-5678'
          },
          deliveryService: ['standard', 'express', 'same_day'][Math.floor(Math.random() * 3)],
          priority: fo.priority,
          slaDeadline: new Date(Date.now() + Math.random() * 72 * 60 * 60 * 1000),
          totalItems: items.length,
          totalWeight: Math.random() * 10 + 1,
          totalValue: Math.random() * 200000 + 50000,
          items: items.map(item => ({
            salesOrderLineId: item.salesOrderLineId,
            productId: `PROD-${item.skuId.slice(-6)}`,
            variantId: `VAR-${item.skuId.slice(-4)}`,
            qty: item.qty,
            weight: Math.random() * 2 + 0.1,
            dimensions: {
              length: Math.random() * 30 + 10,
              width: Math.random() * 20 + 10,
              height: Math.random() * 15 + 5
            }
          })),
          warehouseId,
          createdAt: fo.createdAt!
        };

        candidates.push(candidate);
      }
    }

    this.logger.log(`Found ${candidates.length} consolidation candidates in warehouse ${warehouseId}`);
    return candidates;
  }

  async generateConsolidationGroups(
    candidates: ConsolidationCandidate[],
    rules: ConsolidationRule[] = this.defaultRules
  ): Promise<ConsolidationGroup[]> {
    const groups: ConsolidationGroup[] = [];
    const processed = new Set<string>();

    // Sort rules by priority
    const sortedRules = rules.filter(r => r.enabled).sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const availableCandidates = candidates.filter(c => !processed.has(c.salesOrderId));

      for (let i = 0; i < availableCandidates.length; i++) {
        const primaryCandidate = availableCandidates[i];
        if (processed.has(primaryCandidate.salesOrderId)) continue;

        const groupCandidates = [primaryCandidate];
        processed.add(primaryCandidate.salesOrderId);

        // Find matching candidates based on rule criteria
        for (let j = i + 1; j < availableCandidates.length; j++) {
          const candidate = availableCandidates[j];
          if (processed.has(candidate.salesOrderId)) continue;

          if (this.matchesCriteria(primaryCandidate, candidate, rule)) {
            groupCandidates.push(candidate);
            processed.add(candidate.salesOrderId);

            if (groupCandidates.length >= rule.constraints.maxOrdersPerGroup) {
              break;
            }
          }
        }

        // Only create group if we have multiple orders
        if (groupCandidates.length > 1) {
          const group = this.createConsolidationGroup(groupCandidates, rule);
          if (group) {
            groups.push(group);
          }
        } else {
          // Remove from processed if no group was formed
          processed.delete(primaryCandidate.salesOrderId);
        }
      }
    }

    this.logger.log(`Generated ${groups.length} consolidation groups from ${candidates.length} candidates`);
    return groups;
  }

  private matchesCriteria(
    primary: ConsolidationCandidate,
    candidate: ConsolidationCandidate,
    rule: ConsolidationRule
  ): boolean {
    // Check time window
    const timeDiff = Math.abs(candidate.createdAt.getTime() - primary.createdAt.getTime());
    if (timeDiff > rule.criteria.timeWindow * 60 * 60 * 1000) {
      return false;
    }

    // Check customer match
    if (rule.criteria.customerMatch && primary.customerId !== candidate.customerId) {
      return false;
    }

    // Check service match
    if (rule.criteria.serviceMatch && primary.deliveryService !== candidate.deliveryService) {
      return false;
    }

    // Check address match
    if (!this.matchesAddress(primary.shippingAddress, candidate.shippingAddress, rule.criteria.addressMatch)) {
      return false;
    }

    // Check priority requirement
    if (rule.constraints.requireSamePriority && primary.priority !== candidate.priority) {
      return false;
    }

    return true;
  }

  private matchesAddress(
    addr1: ConsolidationCandidate['shippingAddress'],
    addr2: ConsolidationCandidate['shippingAddress'],
    matchType: 'exact' | 'fuzzy' | 'postal_code' | 'city'
  ): boolean {
    switch (matchType) {
      case 'exact':
        return addr1.address === addr2.address && addr1.postalCode === addr2.postalCode;
      case 'postal_code':
        return addr1.postalCode === addr2.postalCode;
      case 'city':
        return addr1.city === addr2.city;
      case 'fuzzy':
        // Simple fuzzy matching - could be enhanced with more sophisticated algorithms
        return (
          addr1.city === addr2.city &&
          (addr1.postalCode === addr2.postalCode ||
           Math.abs(parseInt(addr1.postalCode) - parseInt(addr2.postalCode)) < 100)
        );
      default:
        return false;
    }
  }

  private createConsolidationGroup(
    candidates: ConsolidationCandidate[],
    rule: ConsolidationRule
  ): ConsolidationGroup | null {
    const totalWeight = candidates.reduce((sum, c) => sum + (c.totalWeight || 0), 0);
    const totalValue = candidates.reduce((sum, c) => sum + (c.totalValue || 0), 0);
    const totalItems = candidates.reduce((sum, c) => sum + c.totalItems, 0);

    // Check constraints
    if (totalWeight > rule.constraints.maxTotalWeight ||
        totalValue > rule.constraints.maxTotalValue ||
        totalItems > rule.constraints.maxOrdersPerGroup * 10) {
      return null;
    }

    const earliestSla = new Date(Math.min(...candidates.map(c => c.slaDeadline.getTime())));
    const primary = candidates[0];

    const groupId = `CON-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const consolidationKey = this.generateConsolidationKey(primary, rule);

    return {
      groupId,
      consolidationKey,
      reason: this.determineConsolidationReason(rule),
      confidence: this.calculateConfidence(candidates, rule),
      salesOrders: candidates,
      estimatedSavings: {
        shippingCost: (candidates.length - 1) * 3000, // ₩3,000 per additional order
        packagingReduction: candidates.length * 500, // ₩500 per order
        efficiencyGain: candidates.length * 1000 // ₩1,000 efficiency gain per order
      },
      constraints: {
        maxWeight: rule.constraints.maxTotalWeight,
        maxVolume: rule.constraints.maxTotalVolume,
        maxItems: totalItems,
        slaDeadline: earliestSla
      },
      recommendation: rule.actions.autoConsolidate ? 'auto_consolidate' : 'manual_review'
    };
  }

  private generateConsolidationKey(candidate: ConsolidationCandidate, rule: ConsolidationRule): string {
    const parts = [
      rule.criteria.customerMatch ? candidate.customerId : 'MIXED',
      candidate.shippingAddress.postalCode,
      candidate.deliveryService
    ];
    return parts.join('-');
  }

  private determineConsolidationReason(rule: ConsolidationRule): ConsolidationGroup['reason'] {
    if (rule.criteria.addressMatch === 'exact' && rule.criteria.customerMatch) {
      return 'same_address';
    } else if (rule.criteria.customerMatch && rule.criteria.maxDistance) {
      return 'same_customer_nearby';
    } else if (rule.criteria.serviceMatch) {
      return 'same_service_zone';
    } else {
      return 'manual';
    }
  }

  private calculateConfidence(candidates: ConsolidationCandidate[], rule: ConsolidationRule): number {
    let confidence = 50; // Base confidence

    // Boost confidence for exact matches
    if (rule.criteria.addressMatch === 'exact') confidence += 30;
    if (rule.criteria.customerMatch) confidence += 20;
    if (rule.criteria.serviceMatch) confidence += 10;

    // Reduce confidence for constraints violations
    const totalWeight = candidates.reduce((sum, c) => sum + (c.totalWeight || 0), 0);
    const weightRatio = totalWeight / rule.constraints.maxTotalWeight;
    if (weightRatio > 0.8) confidence -= 10;

    return Math.min(100, Math.max(0, confidence));
  }

  async autoConsolidate(groupId: string): Promise<{
    fulfillmentOrderId: string;
    consolidatedOrders: string[];
  }> {
    // TODO: Implement actual auto-consolidation
    // This would involve:
    // 1. Creating a new FO that combines all the sales orders
    // 2. Updating the existing FOs or canceling them
    // 3. Creating FOIs for the consolidated order

    this.logger.log(`Auto-consolidating group ${groupId}`);

    // Mock response for now
    return {
      fulfillmentOrderId: `FO-CONSOLIDATED-${Date.now()}`,
      consolidatedOrders: [`SO-${Date.now()}-1`, `SO-${Date.now()}-2`]
    };
  }

  async getConsolidationReport(warehouseId: string, dateFrom?: Date, dateTo?: Date): Promise<{
    period: { from: Date; to: Date };
    summary: {
      totalCandidates: number;
      groupsGenerated: number;
      autoConsolidated: number;
      manuallyReviewed: number;
      totalSavings: number;
    };
    performance: {
      consolidationRate: number;
      avgSavingsPerGroup: number;
      topReasons: Array<{
        reason: string;
        count: number;
        savings: number;
      }>;
    };
  }> {
    // TODO: Implement actual reporting from historical data
    // For now, return mock data

    const from = dateFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = dateTo || new Date();

    return {
      period: { from, to },
      summary: {
        totalCandidates: 156,
        groupsGenerated: 34,
        autoConsolidated: 18,
        manuallyReviewed: 16,
        totalSavings: 234000
      },
      performance: {
        consolidationRate: 0.22, // 22% of candidates were consolidated
        avgSavingsPerGroup: 6882,
        topReasons: [
          { reason: 'same_address', count: 12, savings: 98000 },
          { reason: 'same_customer_nearby', count: 8, savings: 67000 },
          { reason: 'same_service_zone', count: 14, savings: 69000 }
        ]
      }
    };
  }
}