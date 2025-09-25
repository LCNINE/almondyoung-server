// apps/notification/src/shared/services/user-integration.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class UserIntegrationService {
  private readonly logger = new Logger(UserIntegrationService.name);
  private readonly userServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3001';
  }

  async getUserProfile(userId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.userServiceUrl}/api/v1/users/${userId}`)
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get user profile for ${userId}: ${error.message}`);
      throw new HttpException(
        'Failed to get user profile',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUsersByCriteria(criteria: any): Promise<{ users: any[] }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.userServiceUrl}/api/v1/users/search`, criteria)
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get users by criteria: ${error.message}`);
      throw new HttpException(
        'Failed to get users by criteria',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
