import { Injectable, Logger } from '@nestjs/common';
import { CmsOperationError, CMS_CUSTOMER_MESSAGES, isCmsProviderAuthError } from './cms-errors';

// ─── Response types ──────────────────────────────────────────────────────────

interface CmsMemberData {
  status?: string;
  memberId?: string;
  memberName?: string;
  paymentCompany?: string;
  paymentNumber?: string;
  payerName?: string;
  result?: { flag?: string | null; code?: string | null; message?: string | null };
  links?: Array<{ rel: string; href: string }>;
  [key: string]: unknown;
}

interface CmsAgreementData {
  registerStatus?: string;
  agreementKey?: string;
  memberId?: string;
  memberName?: string | null;
  result?: { code?: string | null; message?: string | null };
  [key: string]: unknown;
}

export interface CmsPaymentData {
  status?: string;
  transactionId?: string;
  memberId?: string;
  memberName?: string;
  paymentDate?: string;
  callAmount?: number;
  actualAmount?: number;
  fee?: number;
  result?: { flag?: string | null; code?: string | null; message?: string | null };
  links?: Array<{ rel: string; href: string }>;
}

export interface CmsMemberResponse {
  member: CmsMemberData;
}

export interface CmsAgreementResponse {
  agreementFile: CmsAgreementData;
}

export interface CmsWithdrawalResponse {
  payment: CmsPaymentData;
}

export interface CmsWithdrawalSearchResponse {
  totalCnt: number;
  payments: CmsPaymentData[];
  page?: {
    pageNumber: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
}

export interface CmsApiError {
  code: string;
  message: string;
}

export type CmsApiResult<T> = { ok: true; data: T } | { ok: false; error: CmsApiError; statusCode: number };

// ─── Request DTOs ────────────────────────────────────────────────────────────

export interface CreateCmsMemberDto {
  memberId: string;
  memberName: string;
  phone?: string;
  paymentKind: 'CMS';
  paymentCompany: string;
  paymentNumber: string;
  payerName: string;
  payerNumber: string;
}

export interface UpdateCmsMemberDto {
  paymentKind: 'CMS';
  phone?: string;
  paymentCompany?: string;
  paymentNumber?: string;
  payerName?: string;
  payerNumber?: string;
}

export interface RequestCmsWithdrawalDto {
  transactionId: string;
  memberId: string;
  paymentDate: string;
  callAmount: number;
}

export interface UpdateCmsWithdrawalDto {
  paymentDate: string;
  callAmount: number;
}

export interface SearchCmsWithdrawalsParams {
  fromPaymentDate?: string;
  toPaymentDate?: string;
  memberId?: string;
  memberName?: string;
  pageSize?: number;
  pageNumber?: number;
}

@Injectable()
export class CmsApiClient {
  private readonly logger = new Logger(CmsApiClient.name);
  private readonly timeoutMs = Number(process.env.HYOSUNG_CMS_TIMEOUT_MS ?? 15_000);

  private get apiUrl(): string {
    return process.env.HYOSUNG_CMS_API_URL ?? 'https://api.hyosungcms.co.kr';
  }

  private get addUrl(): string {
    return process.env.HYOSUNG_CMS_ADD_URL ?? 'https://add.hyosungcms.co.kr';
  }

  private get swKey(): string {
    return process.env.HYOSUNG_CMS_SW_KEY ?? process.env.SW_KEY ?? '';
  }

  private get custKey(): string {
    return process.env.HYOSUNG_CMS_CUST_KEY ?? process.env.CUST_KEY ?? '';
  }

  private get custId(): string {
    return process.env.HYOSUNG_CMS_CUST_ID ?? process.env.CUST_ID ?? '';
  }

  private get requiredCustId(): string {
    if (!this.custId) {
      throw new CmsOperationError(
        'CMS_PROVIDER_CONFIG_MISSING',
        CMS_CUSTOMER_MESSAGES.providerIssue,
        502,
        'HYOSUNG_CMS_CUST_ID is not configured',
      );
    }
    return this.custId;
  }

  // ─── 회원관리 ──────────────────────────────────────────────────────────────

  async createMember(dto: CreateCmsMemberDto): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.post<CmsMemberResponse>(`${this.apiUrl}/v1/members`, dto);
  }

  async updateMember(memberId: string, dto: UpdateCmsMemberDto): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.put<CmsMemberResponse>(`${this.apiUrl}/v1/members/${memberId}`, dto);
  }

  async deleteMember(memberId: string): Promise<CmsApiResult<void>> {
    return this.del<void>(`${this.apiUrl}/v1/members/${memberId}`);
  }

  async getMember(memberId: string): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.get<CmsMemberResponse>(`${this.apiUrl}/v1/members/${memberId}`);
  }

  // ─── 동의자료관리 ──────────────────────────────────────────────────────────

  async uploadAgreement(
    memberId: string,
    file: Buffer,
    fileType: string,
    fileExtension: string,
  ): Promise<CmsApiResult<CmsAgreementResponse>> {
    const url = `${this.addUrl}/v1/custs/${this.requiredCustId}/agreements`;
    this.logger.debug(`POST ${url} (multipart)`);

    const formData = new FormData();
    formData.append('memberId', memberId);
    formData.append('fileType', fileType);
    formData.append('fileExtension', fileExtension);
    formData.append('file', new Blob([new Uint8Array(file)]), `agreement.${fileExtension}`);

    return this.request<CmsAgreementResponse>(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: formData,
    });
  }

  async getAgreement(agreementKey: string): Promise<CmsApiResult<CmsAgreementResponse>> {
    return this.get<CmsAgreementResponse>(`${this.addUrl}/v1/custs/${this.requiredCustId}/agreements/${agreementKey}`);
  }

  // ─── 출금관리 ──────────────────────────────────────────────────────────────

  async requestWithdrawal(dto: RequestCmsWithdrawalDto): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.post<CmsWithdrawalResponse>(`${this.apiUrl}/v1/payments/cms`, dto);
  }

  async updateWithdrawal(
    transactionId: string,
    dto: UpdateCmsWithdrawalDto,
  ): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.put<CmsWithdrawalResponse>(`${this.apiUrl}/v1/payments/cms/${transactionId}`, dto);
  }

  async deleteWithdrawal(transactionId: string): Promise<CmsApiResult<void>> {
    return this.del<void>(`${this.apiUrl}/v1/payments/cms/${transactionId}`);
  }

  async getWithdrawal(transactionId: string): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.get<CmsWithdrawalResponse>(`${this.apiUrl}/v1/payments/cms/${transactionId}`);
  }

  async searchWithdrawals(params: SearchCmsWithdrawalsParams): Promise<CmsApiResult<CmsWithdrawalSearchResponse>> {
    const query = new URLSearchParams();
    if (params.fromPaymentDate) query.set('fromPaymentDate', params.fromPaymentDate);
    if (params.toPaymentDate) query.set('toPaymentDate', params.toPaymentDate);
    if (params.memberId) query.set('memberId', params.memberId);
    if (params.memberName) query.set('memberName', params.memberName);
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
    if (params.pageNumber !== undefined) query.set('pageNumber', String(params.pageNumber));

    return this.get<CmsWithdrawalSearchResponse>(`${this.apiUrl}/v1/payments/cms?${query.toString()}`);
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    if (!this.swKey || !this.custKey) {
      throw new CmsOperationError(
        'CMS_PROVIDER_CONFIG_MISSING',
        CMS_CUSTOMER_MESSAGES.providerIssue,
        502,
        'HYOSUNG_CMS_SW_KEY/HYOSUNG_CMS_CUST_KEY is not configured',
      );
    }

    return {
      Authorization: `VAN ${this.swKey}:${this.custKey}`,
    };
  }

  private jsonHeaders(): Record<string, string> {
    return {
      ...this.authHeaders(),
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(url: string, body: object): Promise<CmsApiResult<T>> {
    this.logger.debug(`POST ${url}`);
    return this.request<T>(url, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
  }

  private async put<T>(url: string, body: object): Promise<CmsApiResult<T>> {
    this.logger.debug(`PUT ${url}`);
    return this.request<T>(url, {
      method: 'PUT',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
  }

  private async del<T>(url: string): Promise<CmsApiResult<T>> {
    this.logger.debug(`DELETE ${url}`);
    return this.request<T>(url, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
  }

  private async get<T>(url: string): Promise<CmsApiResult<T>> {
    this.logger.debug(`GET ${url}`);
    return this.request<T>(url, {
      method: 'GET',
      headers: this.authHeaders(),
    });
  }

  private async request<T>(url: string, init: RequestInit): Promise<CmsApiResult<T>> {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return this.handleResponse<T>(res);
    } catch (err) {
      const message = this.describeFetchError(err);
      this.logger.error(`CMS API network error: ${message} url=${url}`);
      return {
        ok: false,
        error: { code: 'CMS_NETWORK_ERROR', message },
        statusCode: 503,
      };
    }
  }

  private async handleResponse<T>(res: Response): Promise<CmsApiResult<T>> {
    if (res.status === 204) {
      return { ok: true, data: undefined as unknown as T };
    }

    const body = await res.json().catch(() => null);

    if (res.ok) {
      return { ok: true, data: body as T };
    }

    const providerCode = body?.code ?? body?.error?.code ?? String(res.status);
    const providerMessage = body?.message ?? body?.error?.message ?? body?.error?.developerMessage ?? 'Unknown error';
    const error: CmsApiError = {
      code:
        res.status === 401 || res.status === 403 || isCmsProviderAuthError(String(providerCode), providerMessage)
          ? 'CMS_PROVIDER_AUTH_FAILED'
          : String(providerCode),
      message: providerMessage,
    };
    this.logger.error(`CMS API error: ${res.status} ${JSON.stringify(error)}`);
    return { ok: false, error, statusCode: res.status };
  }

  private describeFetchError(err: unknown): string {
    if (!(err instanceof Error)) {
      return String(err);
    }

    const cause = err.cause;
    if (cause instanceof Error) {
      const causeCode = 'code' in cause ? ` ${(cause as Error & { code?: string }).code}` : '';
      return `${err.name}: ${err.message}; cause=${cause.name}${causeCode}: ${cause.message}`;
    }

    return `${err.name}: ${err.message}`;
  }
}
