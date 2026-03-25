import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface CreateWmsMasterDto {
  name: string;
  masterCode: string;
  optionSchema: Array<{
    name: string;
    values: string[];
  }>;
}

export interface WmsMasterResponse {
  id: string;
}

export interface CreateProductMatchingDto {
  variantId: string;
  masterId: string;
  strategy: 'variant' | 'option' | 'void';
}

@Injectable()
export class WmsApiService {
  private readonly logger = new Logger(WmsApiService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get('WMS_SERVICE_URL', 'http://localhost:3002');
  }

  async createMaster(dto: CreateWmsMasterDto): Promise<WmsMasterResponse> {
    this.logger.log(`Creating WMS master: ${dto.name}`);
    const response = await firstValueFrom(
      this.httpService.post<WmsMasterResponse>(`${this.baseUrl}/api/inventory/masters`, dto),
    );
    return response.data;
  }

  async deleteMaster(masterId: string): Promise<void> {
    this.logger.log(`Deleting WMS master: ${masterId}`);
    await firstValueFrom(this.httpService.delete(`${this.baseUrl}/api/inventory/masters/${masterId}`));
  }

  async createProductMatching(dto: CreateProductMatchingDto): Promise<{ id: string }> {
    this.logger.log(`Creating product matching: ${dto.variantId} -> ${dto.masterId}`);
    const response = await firstValueFrom(this.httpService.post<{ id: string }>(`${this.baseUrl}/api/matchings`, dto));
    return response.data;
  }
}
