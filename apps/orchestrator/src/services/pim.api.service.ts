import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface CreatePimMasterDto {
  name: string;
  brand?: string;
  optionGroups: Array<{
    name: string;
    values: string[];
  }>;
}

export interface PimMasterResponse {
  id: string;
  variantIds: string[];
}

@Injectable()
export class PimApiService {
  private readonly logger = new Logger(PimApiService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get(
      'PIM_SERVICE_URL',
      'http://localhost:3001',
    );
  }

  async createMaster(dto: CreatePimMasterDto): Promise<PimMasterResponse> {
    this.logger.log(`Creating PIM master: ${dto.name}`);
    const response = await firstValueFrom(
      this.httpService.post<PimMasterResponse>(
        `${this.baseUrl}/api/masters`,
        dto,
      ),
    );
    return response.data;
  }

  async deleteMaster(masterId: string): Promise<void> {
    this.logger.log(`Deleting PIM master: ${masterId}`);
    await firstValueFrom(
      this.httpService.delete(`${this.baseUrl}/api/masters/${masterId}`),
    );
  }
}
