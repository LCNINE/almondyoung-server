import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as FormData from 'form-data';

/**
 * HMS Batch CMS API 직접 호출 서비스
 * hms-api-wrapper 대신 직접 HTTP 요청을 처리하여 에러 메시지 전파를 명확하게 함
 */
@Injectable()
export class HmsBatchCmsService {
  private readonly logger = new Logger(HmsBatchCmsService.name);
  private readonly memberApiClient: AxiosInstance;
  private readonly agreementApiClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const swKey = this.configService.get<string>('SW_KEY');
    const custKey = this.configService.get<string>('CUST_KEY');
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    const proxyUrl = this.configService.get<string>('HYOSUNG_PROXY_URL');

    this.logger.log(`🔧 HmsBatchCmsService 초기화`);
    this.logger.log(`  - NODE_ENV: ${process.env.NODE_ENV}`);
    this.logger.log(`  - HYOSUNG_PROXY_URL: ${proxyUrl || '(설정 안 됨)'}`);
    this.logger.log(`  - SW_KEY: ${swKey ? '설정됨' : '(설정 안 됨)'}`);
    this.logger.log(`  - CUST_KEY: ${custKey ? '설정됨' : '(설정 안 됨)'}`);

    if (!swKey || !custKey) {
      throw new Error(
        'HMS API 키가 필요합니다. 환경변수를 확인하세요: SW_KEY, CUST_KEY',
      );
    }

    // 회원 API 클라이언트 (api-test 또는 api)
    // hms-card와 동일한 방식으로 설정 (HmsApiFactory.createForCard() 참고)
    // nginx 프록시 설정:
    // - location / → proxy_pass https://api-test.hyosungcms.co.kr
    // - 프록시 사용 시: baseURL = ${proxyUrl}/v1, 요청 경로: /members
    // - 최종: ${proxyUrl}/v1/members → nginx가 https://api-test.hyosungcms.co.kr/v1/members로 전달
    let memberBaseURL: string;
    if (isProduction) {
      memberBaseURL = 'https://api.hyosungcms.co.kr/v1';
    } else if (proxyUrl) {
      // hms-card와 동일: 프록시 URL에 /v1 포함
      memberBaseURL = `${proxyUrl}/v1`;
      this.logger.log(
        `🔧 회원 API 프록시 사용: ${memberBaseURL} (요청 경로: /members)`,
      );
    } else {
      memberBaseURL = 'https://api-test.hyosungcms.co.kr/v1';
    }

    this.logger.log(`  - 회원 API baseURL: ${memberBaseURL}`);

    this.memberApiClient = axios.create({
      baseURL: memberBaseURL,
      timeout: 30000,
      headers: {
        Authorization: `VAN ${swKey}:${custKey}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    });

    // 동의서 API 클라이언트 (add-test 또는 add)
    let agreementBaseURL: string;
    if (isProduction) {
      agreementBaseURL = 'https://add.hyosungcms.co.kr/v1';
    } else if (proxyUrl) {
      agreementBaseURL = `${proxyUrl}/add/v1`;
    } else {
      agreementBaseURL = 'https://add-test.hyosungcms.co.kr/v1';
    }

    this.agreementApiClient = axios.create({
      baseURL: agreementBaseURL,
      timeout: 60000,
      headers: {
        Authorization: `VAN ${swKey}:${custKey}`,
        charset: 'UTF-8',
        // Content-Type은 FormData 사용 시 자동으로 설정됨
      },
    });

    // 에러 인터셉터 설정
    this.setupErrorInterceptor(this.memberApiClient, 'Member API');
    this.setupErrorInterceptor(this.agreementApiClient, 'Agreement API');
  }

  /**
   * HMS API 에러를 명확한 메시지로 변환
   */
  private setupErrorInterceptor(client: AxiosInstance, apiName: string) {
    client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.data) {
          const errorData = error.response.data as any;
          const hmsError = {
            message:
              errorData.error?.message || error.message || 'Unknown error',
            developerMessage:
              errorData.error?.developerMessage ||
              errorData.error?.message ||
              error.message,
            statusCode: error.response.status,
            apiName,
          };

          this.logger.error(
            `❌ ${apiName} 에러: ${hmsError.message}`,
            hmsError.developerMessage
              ? `Developer Message: ${hmsError.developerMessage}`
              : undefined,
          );

          // 커스텀 에러 객체로 변환
          const customError = new Error(hmsError.message);
          (customError as any).hmsError = hmsError;
          (customError as any).name = 'HmsApiError';
          throw customError;
        }
        throw error;
      },
    );
  }

  /**
   * 회원 등록
   */
  async createMember(data: {
    memberId: string;
    memberName: string;
    payerName: string;
    paymentKind: 'CMS';
    paymentCompany: string;
    paymentNumber: string;
    payerNumber: string;
    phone: string;
  }) {
    this.logger.log(`➡️ HMS 회원 등록 요청: ${data.memberId}`);
    this.logger.debug(`요청 데이터: ${JSON.stringify(data, null, 2)}`);

    try {
      // hms-card와 동일: baseURL에 /v1이 포함되어 있으므로 요청 경로는 /members만 사용
      const fullUrl = `${this.memberApiClient.defaults.baseURL}/members`;
      this.logger.log(`📤 HMS 회원 등록 요청 URL: ${fullUrl}`);
      this.logger.debug(`요청 데이터: ${JSON.stringify(data, null, 2)}`);

      const response = await this.memberApiClient.post('/members', data);
      const result = response.data;

      this.logger.log(`📥 HMS 회원 등록 응답 받음 (HTTP ${response.status})`);
      this.logger.log(`응답 데이터 전체: ${JSON.stringify(result, null, 2)}`);

      // 응답 구조 확인
      this.logger.log(`result.member 존재: ${!!result.member}`);
      this.logger.log(`result.member.result 존재: ${!!result.member?.result}`);
      this.logger.log(
        `result.member.result.flag: ${result.member?.result?.flag}`,
      );
      this.logger.log(`result.member.status: ${result.member?.status}`);

      // HMS API 문서에 따르면 성공 시 result.member.result.flag === 'Y'
      // 하지만 실제 응답에서는 status 필드를 사용할 수도 있음
      const isSuccess =
        result.member?.result?.flag === 'Y' ||
        result.member?.status === '신청대기' ||
        (result.member && !result.member.result); // result가 없으면 성공으로 간주

      if (!isSuccess) {
        const reason = result.member?.result?.message || '회원 등록 실패';
        const code = result.member?.result?.code;
        this.logger.warn(
          `⚠️ HMS 회원 등록 실패: ${reason}${code ? ` (코드: ${code})` : ''}`,
        );
        this.logger.warn(
          `회원 등록 실패 상세 응답: ${JSON.stringify(result, null, 2)}`,
        );
        return {
          success: false,
          message: reason,
          data: result,
        };
      }

      this.logger.log(`✅ HMS 회원 등록 성공: ${data.memberId}`);
      return {
        success: true,
        data: result,
        memberId: result.member?.memberId,
      };
    } catch (error: any) {
      // Axios 에러인 경우 상세 로깅
      if (error.response) {
        this.logger.error(
          `❌ HMS 회원 등록 실패 (HTTP ${error.response.status}):`,
        );
        this.logger.error(
          `응답 데이터: ${JSON.stringify(error.response.data, null, 2)}`,
        );
        this.logger.error(
          `요청 URL: ${error.config?.url || 'unknown'}, Method: ${error.config?.method || 'unknown'}`,
        );
        this.logger.error(
          `요청 baseURL: ${error.config?.baseURL || 'unknown'}`,
        );
        if (error.config?.data) {
          try {
            const requestData =
              typeof error.config.data === 'string'
                ? JSON.parse(error.config.data)
                : error.config.data;
            this.logger.error(
              `요청 데이터: ${JSON.stringify(requestData, null, 2)}`,
            );
          } catch (e) {
            this.logger.error(`요청 데이터 파싱 실패: ${error.config.data}`);
          }
        }
      } else if (error.request) {
        // 요청은 보냈지만 응답을 받지 못한 경우
        this.logger.error(`❌ HMS 회원 등록 실패 (응답 없음):`);
        this.logger.error(`요청 URL: ${error.config?.url || 'unknown'}`);
        this.logger.error(
          `요청 baseURL: ${error.config?.baseURL || 'unknown'}`,
        );
        this.logger.error(`에러 메시지: ${error.message}`);
      } else {
        // 요청 설정 중 에러 발생
        this.logger.error(
          `❌ HMS 회원 등록 실패 (요청 설정 에러): ${error.message}`,
        );
      }

      const hmsError = error.hmsError || {
        message: error.message || '회원 등록 중 오류 발생',
        developerMessage: error.message,
      };

      // 상세 에러 메시지 포함 (응답 데이터의 에러 메시지 우선 사용)
      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.error?.developerMessage ||
        hmsError.message;

      const developerMessage =
        error.response?.data?.error?.developerMessage ||
        hmsError.developerMessage;

      this.logger.error(
        `❌ HMS 회원 등록 실패: ${errorMessage}`,
        developerMessage && developerMessage !== errorMessage
          ? `Developer Message: ${developerMessage}`
          : undefined,
      );

      throw new Error(
        `HMS 회원 등록 실패: ${errorMessage}${
          developerMessage && developerMessage !== errorMessage
            ? ` (${developerMessage})`
            : ''
        }`,
      );
    }
  }

  /**
   * 동의서 파일 등록
   */
  async registerAgreement(
    custId: string,
    memberId: string,
    file: Buffer,
    filename: string,
  ) {
    this.logger.log(
      `➡️ HMS 동의서 등록 요청: custId=${custId}, memberId=${memberId}`,
    );

    try {
      const formData = new FormData();
      formData.append('memberId', memberId);
      formData.append('file', file, {
        filename,
        contentType: 'image/png',
      });

      const response = await this.agreementApiClient.post(
        `/custs/${custId}/agreements`,
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      const result = response.data;

      if (!result.agreementFile?.agreementKey) {
        const reason = '동의서 응답에 agreementKey가 없습니다.';
        this.logger.error(`❌ HMS 동의서 등록 실패: ${reason}`);
        return {
          success: false,
          message: reason,
          data: result,
        };
      }

      this.logger.log(
        `✅ HMS 동의서 등록 성공: ${result.agreementFile.agreementKey}`,
      );

      return {
        success: true,
        data: result,
        agreementKey: result.agreementFile.agreementKey,
      };
    } catch (error: any) {
      const hmsError = error.hmsError || {
        message: error.message || '동의서 등록 중 오류 발생',
        developerMessage: error.message,
      };

      this.logger.error(
        `❌ HMS 동의서 등록 실패: ${hmsError.message}`,
        hmsError.developerMessage
          ? `Developer Message: ${hmsError.developerMessage}`
          : undefined,
      );

      throw new Error(
        `HMS 동의서 등록 실패: ${hmsError.message}${
          hmsError.developerMessage ? ` (${hmsError.developerMessage})` : ''
        }`,
      );
    }
  }

  /**
   * 회원 삭제 (보상 트랜잭션용)
   * 동의서 등록 실패 시 등록된 회원을 삭제하기 위해 사용됩니다.
   */
  async deleteMember(memberId: string) {
    this.logger.log(`➡️ HMS 회원 삭제 요청: ${memberId}`);

    try {
      const response = await this.memberApiClient.delete(`/members/${memberId}`);

      // 204 No Content가 정상 응답
      if (response.status === 204 || response.status === 200) {
        this.logger.log(`✅ HMS 회원 삭제 성공: ${memberId}`);
        return {
          success: true,
        };
      }

      this.logger.warn(
        `⚠️ HMS 회원 삭제 예상치 못한 응답: HTTP ${response.status}`,
      );
      return {
        success: false,
        message: `Unexpected status code: ${response.status}`,
      };
    } catch (error: any) {
      // Axios 에러인 경우 상세 로깅
      if (error.response) {
        this.logger.error(
          `❌ HMS 회원 삭제 실패 (HTTP ${error.response.status}):`,
        );
        this.logger.error(
          `응답 데이터: ${JSON.stringify(error.response.data, null, 2)}`,
        );

        // 404는 이미 삭제된 경우이므로 성공으로 간주할 수 있음
        if (error.response.status === 404) {
          this.logger.warn(
            `⚠️ 회원이 이미 삭제되었거나 존재하지 않음: ${memberId}`,
          );
          return {
            success: true,
            message: 'Member already deleted or not found',
          };
        }
      } else if (error.request) {
        this.logger.error(`❌ HMS 회원 삭제 실패 (응답 없음): ${error.message}`);
      } else {
        this.logger.error(
          `❌ HMS 회원 삭제 실패 (요청 설정 에러): ${error.message}`,
        );
      }

      const hmsError = error.hmsError || {
        message: error.message || '회원 삭제 중 오류 발생',
        developerMessage: error.message,
      };

      const errorMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.error?.developerMessage ||
        hmsError.message;

      throw new Error(
        `HMS 회원 삭제 실패: ${errorMessage}${
          hmsError.developerMessage && hmsError.developerMessage !== errorMessage
            ? ` (${hmsError.developerMessage})`
            : ''
        }`,
      );
    }
  }
}
