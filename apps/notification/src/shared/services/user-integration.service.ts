import { Injectable, Logger, InternalServerErrorException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class UserIntegrationService {
  private readonly logger = new Logger(UserIntegrationService.name);
  private readonly USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3000';

  async getUserProfile(userId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.USER_SERVICE_URL}/api/v1/consents/profile/${userId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch user profile for userId ${userId}: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to fetch user profile for userId ${userId}: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUserMarketingConsent(userId: string): Promise<boolean> {
    try {
      const response = await axios.get(`${this.USER_SERVICE_URL}/api/v1/consents/marketing/${userId}`);
      return response.data.isMarketingEnabled;
    } catch (error) {
      this.logger.error(`Failed to fetch marketing consent for user ${userId}: ${error.message}`);
      return false; // Default to false or handle as per business logic
    }
  }

  async getUsersByCriteria(criteria: any): Promise<{ users: any[]; totalCount: number }> {
    try {
      const response = await axios.post(`${this.USER_SERVICE_URL}/api/v1/consents/search`, criteria);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch users by criteria: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to fetch users from user-service: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
