import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpSagaOrchestrator } from '../saga/http-saga.orchestrator';
import { StepResponse } from '../saga/create-step';

export interface UnifiedMasterInput {
  name: string;
  brand?: string;
  optionGroups: Array<{
    name: string;
    values: string[];
  }>;
}

@Injectable()
export class UnifiedMasterWorkflow extends HttpSagaOrchestrator {
  private pimBaseUrl: string;
  private wmsBaseUrl: string;

  constructor(
    httpService: HttpService,
    private configService: ConfigService,
  ) {
    super(httpService);
    this.pimBaseUrl = this.configService.get(
      'PIM_SERVICE_URL',
      'http://localhost:3001',
    );
    this.wmsBaseUrl = this.configService.get(
      'WMS_SERVICE_URL',
      'http://localhost:3002',
    );
  }

  async createUnifiedMaster(input: UnifiedMasterInput) {
    this.addStep({
      name: 'create-pim-master',
      execute: async () => {
        const response = await this.httpPost<{
          id: string;
          variantIds: string[];
        }>(`${this.pimBaseUrl}/api/masters`, {
          name: input.name,
          brand: input.brand,
          optionGroups: input.optionGroups,
        });

        return new StepResponse(
          { pimMasterId: response.id, variantIds: response.variantIds },
          { pimMasterId: response.id }, // Rollback data
        );
      },
      compensate: async (rollback: { pimMasterId: string }) => {
        await this.httpDelete(
          `${this.pimBaseUrl}/api/masters/${rollback.pimMasterId}`,
        );
      },
    })
      .addStep({
        name: 'create-wms-master',
        execute: async (ctx: any) => {
          const response = await this.httpPost<{ id: string }>(
            `${this.wmsBaseUrl}/api/inventory/masters`,
            {
              name: input.name,
              masterCode: `M-${ctx.pimMasterId.slice(0, 8)}`,
              optionSchema: input.optionGroups,
            },
          );

          return new StepResponse(
            { wmsMasterId: response.id },
            { wmsMasterId: response.id },
          );
        },
        compensate: async (rollback: { wmsMasterId: string }) => {
          await this.httpDelete(
            `${this.wmsBaseUrl}/api/inventory/masters/${rollback.wmsMasterId}`,
          );
        },
      })
      .addStep({
        name: 'create-product-matching',
        execute: async (ctx: any) => {
          await this.httpPost(`${this.wmsBaseUrl}/api/matchings`, {
            variantId: ctx.variantIds[0],
            masterId: ctx.wmsMasterId,
            strategy: 'variant',
          });

          return new StepResponse({}, undefined); // No rollback needed (cascades)
        },
        compensate: async () => {
          // WMS 마스터 삭제 시 CASCADE되므로 별도 보상 불필요
        },
      });

    return this.execute({ input });
  }
}
