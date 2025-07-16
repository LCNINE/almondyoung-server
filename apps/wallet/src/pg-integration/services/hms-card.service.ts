import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CreateCardMethodDto } from '../dto/create-card-method';

interface HmsCardRegistrationRequest {
  merchantId: string;
  userId: string;
  cardNumber: string;
  expiryDate: string;
  cvc: string;
  holderName: string;
  cardPassword?: string;
}

interface HmsCardRegistrationResponse {
  success: boolean;
  billingKey: string;
  cardInfo: {
    brand: string;
    type: string;
    issuerCode: string;
    issuerName: string;
    maskedNumber: string;
  };
  message?: string;
}

@Injectable()
export class HmsCardService {
  private readonly logger = new Logger(HmsCardService.name);
  private readonly hmsClient: AxiosInstance;
  private readonly merchantId: string;

  constructor(private configService: ConfigService) {
    this.merchantId = this.configService.get<string>('HMS_MERCHANT_ID')!;
    
    this.hmsClient = axios.create({
      baseURL: this.configService.get<string>('HMS_API_BASE_URL'),
      headers: {
        'Authorization': `Bearer ${this.configService.get<string>('HMS_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * HMS API를 통한 카드 등록 및 빌링키 발급
   */
  async registerCard(dto: CreateCardMethodDto): Promise<HmsCardRegistrationResponse> {
    try {
      this.logger.log(`Registering card for user: ${dto.userId}`);

      const request: HmsCardRegistrationRequest = {
        merchantId: this.merchantId,
        userId: String(dto.userId),
        cardNumber: dto.cardNumber,
        expiryDate: this.formatExpiryDate(dto.expiryDate),
        cvc: dto.cvc,
        holderName: dto.holderName,
        cardPassword: dto.cardPassword,
      };

      const response = await this.hmsClient.post<HmsCardRegistrationResponse>(
        '/v1/billing/register-card',
        request
      );

      if (!response.data.success) {
        throw new HttpException(
          response.data.message || '카드 등록에 실패했습니다',
          HttpStatus.BAD_REQUEST
        );
      }

      this.logger.log(`Card registered successfully. BillingKey: ${response.data.billingKey}`);
      return response.data;

    } catch (error) {
      this.logger.error('Card registration failed:', error);
      
      if (error.response?.status === 400) {
        throw new HttpException(
          error.response.data.message || '유효하지 않은 카드 정보입니다',
          HttpStatus.BAD_REQUEST
        );
      }
      
      throw new HttpException(
        '카드 등록 중 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 빌링키로 카드 정보 조회
   */
  async getCardInfo(billingKey: string): Promise<any> {
    try {
      const response = await this.hmsClient.get(`/v1/billing/card-info/${billingKey}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get card info:', error);
      throw new HttpException(
        '카드 정보 조회에 실패했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 빌링키 해지
   */
  async revokeBillingKey(billingKey: string): Promise<void> {
    try {
      await this.hmsClient.delete(`/v1/billing/revoke/${billingKey}`);
      this.logger.log(`Billing key revoked: ${billingKey}`);
    } catch (error) {
      this.logger.error('Failed to revoke billing key:', error);
      throw new HttpException(
        '빌링키 해지에 실패했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 카드 유효성 검증 (0원 승인)
   */
  async validateCard(billingKey: string): Promise<boolean> {
    try {
      const response = await this.hmsClient.post('/v1/billing/validate', {
        billingKey,
        amount: 0,
      });
      
      return response.data.success;
    } catch (error) {
      this.logger.error('Card validation failed:', error);
      return false;
    }
  }

  /**
   * MM/YY 형식을 YYMM으로 변환
   */
  private formatExpiryDate(expiryDate: string): string {
    const [month, year] = expiryDate.split('/');
    return year + month;
  }
}