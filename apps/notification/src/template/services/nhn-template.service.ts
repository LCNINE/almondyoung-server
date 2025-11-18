// apps/notification/src/template/services/nhn-template.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { StructuredLogger } from '../../shared/utils/logger.utils';

/**
 * NHN 카카오 알림톡 템플릿 API 연동 서비스
 * 
 * NHN Cloud API 문서: https://docs.nhncloud.com/ko/Notification/KakaoTalk/ko/api-guide-v2.3/
 */
@Injectable()
export class NHNTemplateService {
  private readonly logger: StructuredLogger;
  private readonly client: AxiosInstance;
  private readonly appKey: string;
  private readonly secretKey: string;
  private readonly senderKey: string;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.logger = new StructuredLogger(new Logger(NHNTemplateService.name));
    
    this.appKey = this.configService.get<string>('NHN_APP_KEY')!;
    this.secretKey = this.configService.get<string>('NHN_SECRET_KEY')!;
    this.senderKey = this.configService.get<string>('NHN_SENDER_KEY')!;
    this.apiUrl = this.configService.get<string>('NHN_API_URL') || 'https://api-alimtalk.cloud.toast.com';

    if (!this.appKey || !this.secretKey || !this.senderKey) {
      throw new Error('NHN_APP_KEY, NHN_SECRET_KEY, NHN_SENDER_KEY 환경변수가 필요합니다.');
    }

    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': this.secretKey,
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        this.logger.error('NHN Template API Error', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        throw error;
      }
    );
  }

  /**
   * 템플릿 카테고리 조회
   */
  async getCategories() {
    const response = await this.client.get(`/alimtalk/v2.3/appkeys/${this.appKey}/template/categories`);
    return response.data;
  }

  /**
   * 템플릿 등록
   */
  async createTemplate(templateData: {
    templateCode: string;
    templateName: string;
    templateContent: string;
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: any;
    templateItemHighlight?: any;
    templateRepresentLink?: any;
    templateImageName?: string;
    templateImageUrl?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: any[];
    quickReplies?: any[];
  }) {
    const response = await this.client.post(
      `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates`,
      templateData
    );
    return response.data;
  }

  /**
   * 템플릿 수정
   */
  async updateTemplate(templateCode: string, templateData: {
    templateName: string;
    templateContent: string;
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: any;
    templateItemHighlight?: any;
    templateRepresentLink?: any;
    templateImageName?: string;
    templateImageUrl?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: any[];
    quickReplies?: any[];
  }) {
    const response = await this.client.put(
      `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates/${templateCode}`,
      templateData
    );
    return response.data;
  }

  /**
   * 템플릿 삭제
   */
  async deleteTemplate(templateCode: string) {
    const response = await this.client.delete(
      `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates/${templateCode}`
    );
    return response.data;
  }

  /**
   * 템플릿 리스트 조회
   */
  async getTemplates(params?: {
    templateCode?: string;
    templateName?: string;
    templateStatus?: string;
    pageNum?: number;
    pageSize?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.templateCode) queryParams.append('templateCode', params.templateCode);
    if (params?.templateName) queryParams.append('templateName', params.templateName);
    if (params?.templateStatus) queryParams.append('templateStatus', params.templateStatus);
    if (params?.pageNum) queryParams.append('pageNum', params.pageNum.toString());
    if (params?.pageSize) queryParams.append('pageSize', params.pageSize.toString());

    const url = `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await this.client.get(url);
    return response.data;
  }

  /**
   * 특정 템플릿 조회 (상태 포함)
   */
  async getTemplate(templateCode: string) {
    const result = await this.getTemplates({ templateCode, pageSize: 1 });
    if (result.templateListResponse?.templates?.length > 0) {
      return result.templateListResponse.templates[0];
    }
    return null;
  }

  /**
   * 템플릿 상태 동기화
   * NHN에서 템플릿 상태를 조회하여 반환
   */
  async syncTemplateStatus(templateCode: string): Promise<{
    status: 'PENDING' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'INACTIVE';
    statusName?: string;
    kakaoTemplateCode?: string;
    error?: string;
  }> {
    try {
      const template = await this.getTemplate(templateCode);
      
      if (!template) {
        return {
          status: 'PENDING',
          error: 'NHN에 등록되지 않은 템플릿입니다.',
        };
      }

      // NHN 상태 코드를 우리 상태로 매핑
      // TSC01: 요청, TSC02: 검수 중, TSC03: 승인, TSC04: 반려
      const statusMap: Record<string, 'PENDING' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'INACTIVE'> = {
        'TSC01': 'REQUESTED',
        'TSC02': 'REQUESTED',
        'TSC03': 'APPROVED',
        'TSC04': 'REJECTED',
      };

      const status = statusMap[template.status] || 'PENDING';

      return {
        status,
        statusName: template.statusName,
        kakaoTemplateCode: template.kakaoTemplateCode,
      };
    } catch (error: any) {
      this.logger.error('Failed to sync template status', {
        templateCode,
        error: error.message,
      });
      return {
        status: 'PENDING',
        error: error.message || '템플릿 상태 동기화 실패',
      };
    }
  }

  /**
   * 템플릿 이미지 업로드
   */
  async uploadTemplateImage(file: Buffer, filename: string) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', file, filename);

    const response = await this.client.post(
      `/alimtalk/v2.3/appkeys/${this.appKey}/template-image`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-Secret-Key': this.secretKey,
        },
      }
    );
    return response.data;
  }

  /**
   * 템플릿 아이템 하이라이트 이미지 업로드
   */
  async uploadItemHighlightImage(file: Buffer, filename: string) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', file, filename);

    const response = await this.client.post(
      `/alimtalk/v2.3/appkeys/${this.appKey}/template-image/item-highlight`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-Secret-Key': this.secretKey,
        },
      }
    );
    return response.data;
  }

  /**
   * 템플릿 문의하기
   */
  async addComment(templateCode: string, comment: string) {
    const response = await this.client.post(
      `/alimtalk/v2.3/appkeys/${this.appKey}/senders/${this.senderKey}/templates/${templateCode}/comments`,
      { comment }
    );
    return response.data;
  }
}

