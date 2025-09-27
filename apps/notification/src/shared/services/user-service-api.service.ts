// apps/notification/src/shared/services/user-service-api.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';

export interface UserProfile {
  userId: string;
  email: string;
  phoneNumber?: string;
  membershipType: 'general' | 'premium';
  isMarketingEnabled: boolean;
  preferredLanguage: 'ko' | 'en';
  shopCategories?: string[];
  deviceInfo?: {
    platform?: 'ios' | 'android' | 'web';
    deviceId?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
  };
}

export interface UserMarketingConsent {
  userId: string;
  isMarketingEnabled: boolean;
  updatedAt: string;
}

export interface UserSearchCriteria {
  membershipType?: 'general' | 'premium';
  shopCategories?: string[];
  isMarketingEnabled?: boolean;
  userIds?: string[];
  limit?: number;
  offset?: number;
}

export interface UserSearchResult {
  users: UserProfile[];
  totalCount: number;
  hasMore: boolean;
}

@Injectable()
export class UserServiceApiService {
  private readonly logger = new Logger(UserServiceApiService.name);
  private readonly USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3000';

  /**
   * 사용자 프로필 조회
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      this.logger.log(`Fetching user profile for userId: ${userId}`);
      
      const response: AxiosResponse<UserProfile> = await axios.get(
        `${this.USER_SERVICE_URL}/api/v1/users/${userId}/profile`,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`User profile fetched successfully for ${userId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`User profile not found for userId: ${userId}`);
        return null;
      }
      
      this.logger.error(`Failed to fetch user profile for ${userId}: ${error.message}`);
      throw new HttpException(
        `Failed to fetch user profile: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 이메일로 사용자 프로필 조회
   */
  async getUserProfileByEmail(email: string): Promise<UserProfile | null> {
    try {
      this.logger.log(`Fetching user profile for email: ${email}`);
      
      const response: AxiosResponse<UserProfile> = await axios.get(
        `${this.USER_SERVICE_URL}/api/v1/users/by-email/${encodeURIComponent(email)}/profile`,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`User profile fetched successfully for ${email}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        this.logger.warn(`User profile not found for email: ${email}`);
        return null;
      }
      
      this.logger.error(`Failed to fetch user profile for ${email}: ${error.message}`);
      throw new HttpException(
        `Failed to fetch user profile: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 사용자 마케팅 동의 여부 조회
   */
  async getUserMarketingConsent(userId: string): Promise<boolean> {
    try {
      this.logger.log(`Fetching marketing consent for userId: ${userId}`);
      
      const response: AxiosResponse<UserMarketingConsent> = await axios.get(
        `${this.USER_SERVICE_URL}/api/v1/users/${userId}/marketing-consent`,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Marketing consent fetched for ${userId}: ${response.data.isMarketingEnabled}`);
      return response.data.isMarketingEnabled;
    } catch (error) {
      this.logger.error(`Failed to fetch marketing consent for ${userId}: ${error.message}`);
      // 마케팅 동의 조회 실패 시 기본값 false 반환 (보수적 접근)
      return false;
    }
  }

  /**
   * 조건에 따른 사용자 목록 조회 (대량 발송용)
   */
  async getUsersByCriteria(criteria: UserSearchCriteria): Promise<UserSearchResult> {
    try {
      this.logger.log(`Fetching users by criteria: ${JSON.stringify(criteria)}`);
      
      const response: AxiosResponse<UserSearchResult> = await axios.post(
        `${this.USER_SERVICE_URL}/api/v1/users/search`,
        criteria,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Users fetched successfully: ${response.data.users.length} users found`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch users by criteria: ${error.message}`);
      throw new HttpException(
        `Failed to fetch users: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 특정 사용자들의 프로필 일괄 조회
   */
  async getUsersByIds(userIds: string[]): Promise<UserProfile[]> {
    try {
      this.logger.log(`Fetching profiles for ${userIds.length} users`);
      
      const response: AxiosResponse<UserProfile[]> = await axios.post(
        `${this.USER_SERVICE_URL}/api/v1/users/batch-profiles`,
        { userIds },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log(`Batch profiles fetched successfully: ${response.data.length} profiles`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch batch profiles: ${error.message}`);
      throw new HttpException(
        `Failed to fetch batch profiles: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 사용자 그룹별 통계 조회
   */
  async getUserGroupStats(): Promise<{
    totalUsers: number;
    marketingEnabledUsers: number;
    membershipStats: {
      general: number;
      premium: number;
    };
  }> {
    try {
      this.logger.log('Fetching user group statistics');
      
      const response: AxiosResponse<any> = await axios.get(
        `${this.USER_SERVICE_URL}/api/v1/users/group-stats`,
        {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.log('User group statistics fetched successfully');
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch user group stats: ${error.message}`);
      throw new HttpException(
        `Failed to fetch user group stats: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
