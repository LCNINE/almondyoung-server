import { Injectable, Logger } from '@nestjs/common';

// ─── Response types ──────────────────────────────────────────────────────────

export interface CmsMemberResponse {
  resultCode: string;
  resultMsg: string;
  memberId?: string;
  memberNm?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CmsAgreementResponse {
  resultCode: string;
  resultMsg: string;
  agreementKey?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CmsWithdrawalResponse {
  resultCode: string;
  resultMsg: string;
  transactionId?: string;
  status?: string;
  actualAmount?: number;
  fee?: number;
  [key: string]: unknown;
}

export interface CmsWithdrawalSearchResponse {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  list: CmsWithdrawalResponse[];
}

export interface CmsApiError {
  code: string;
  message: string;
}

export type CmsApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CmsApiError; statusCode: number };

// ─── Request DTOs ────────────────────────────────────────────────────────────

export interface CreateCmsMemberDto {
  paymentCompany: string;
  payerName: string;
  payerNumber: string;
  bankAccount: string;
}

export interface UpdateCmsMemberDto {
  paymentCompany?: string;
  payerName?: string;
  payerNumber?: string;
  bankAccount?: string;
}

export interface RequestCmsWithdrawalDto {
  memberId: string;
  paymentDate: string;
  amount: number;
  transactionId: string;
}

export interface UpdateCmsWithdrawalDto {
  paymentDate?: string;
  amount?: number;
}

export interface SearchCmsWithdrawalsParams {
  startDate: string;
  endDate: string;
  status?: string;
  page?: number;
  size?: number;
}

@Injectable()
export class CmsApiClient {
  private readonly logger = new Logger(CmsApiClient.name);

  private get apiUrl(): string {
    return process.env.HYOSUNG_CMS_API_URL ?? 'https://api.hyosungcms.co.kr';
  }

  private get addUrl(): string {
    return process.env.HYOSUNG_CMS_ADD_URL ?? 'https://add.hyosungcms.co.kr';
  }

  private get swKey(): string {
    return process.env.HYOSUNG_CMS_SW_KEY ?? '';
  }

  private get custKey(): string {
    return process.env.HYOSUNG_CMS_CUST_KEY ?? '';
  }

  private get custId(): string {
    return process.env.HYOSUNG_CMS_CUST_ID ?? '';
  }

  // ─── 회원관리 ──────────────────────────────────────────────────────────────

  async createMember(dto: CreateCmsMemberDto): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.post<CmsMemberResponse>(`${this.apiUrl}/v1/cms/members`, {
      swKey: this.swKey,
      custKey: this.custKey,
      ...dto,
    });
  }

  async updateMember(memberId: string, dto: UpdateCmsMemberDto): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.put<CmsMemberResponse>(`${this.apiUrl}/v1/cms/members/${memberId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
      ...dto,
    });
  }

  async deleteMember(memberId: string): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.del<CmsMemberResponse>(`${this.apiUrl}/v1/cms/members/${memberId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
    });
  }

  async getMember(memberId: string): Promise<CmsApiResult<CmsMemberResponse>> {
    return this.get<CmsMemberResponse>(`${this.apiUrl}/v1/cms/members/${memberId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
    });
  }

  // ─── 동의자료관리 ──────────────────────────────────────────────────────────

  async uploadAgreement(memberId: string, file: Buffer, fileType: string, fileExtension: string): Promise<CmsApiResult<CmsAgreementResponse>> {
    const url = `${this.addUrl}/v1/cms/agreements`;
    this.logger.debug(`POST ${url} (multipart)`);

    const formData = new FormData();
    formData.append('custId', this.custId);
    formData.append('memberId', memberId);
    formData.append('fileType', fileType);
    formData.append('fileExtension', fileExtension);
    formData.append('file', new Blob([new Uint8Array(file)]), `agreement.${fileExtension}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: formData,
    });

    return this.handleResponse<CmsAgreementResponse>(res);
  }

  async getAgreement(agreementKey: string): Promise<CmsApiResult<CmsAgreementResponse>> {
    return this.get<CmsAgreementResponse>(`${this.addUrl}/v1/cms/agreements/${agreementKey}`, {
      custId: this.custId,
    });
  }

  // ─── 출금관리 ──────────────────────────────────────────────────────────────

  async requestWithdrawal(dto: RequestCmsWithdrawalDto): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.post<CmsWithdrawalResponse>(`${this.apiUrl}/v1/cms/withdrawals`, {
      swKey: this.swKey,
      custKey: this.custKey,
      ...dto,
    });
  }

  async updateWithdrawal(transactionId: string, dto: UpdateCmsWithdrawalDto): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.put<CmsWithdrawalResponse>(`${this.apiUrl}/v1/cms/withdrawals/${transactionId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
      ...dto,
    });
  }

  async deleteWithdrawal(transactionId: string): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.del<CmsWithdrawalResponse>(`${this.apiUrl}/v1/cms/withdrawals/${transactionId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
    });
  }

  async getWithdrawal(transactionId: string): Promise<CmsApiResult<CmsWithdrawalResponse>> {
    return this.get<CmsWithdrawalResponse>(`${this.apiUrl}/v1/cms/withdrawals/${transactionId}`, {
      swKey: this.swKey,
      custKey: this.custKey,
    });
  }

  async searchWithdrawals(params: SearchCmsWithdrawalsParams): Promise<CmsApiResult<CmsWithdrawalSearchResponse>> {
    const query = new URLSearchParams({
      swKey: this.swKey,
      custKey: this.custKey,
      startDate: params.startDate,
      endDate: params.endDate,
      ...(params.status ? { status: params.status } : {}),
      ...(params.page !== undefined ? { page: String(params.page) } : {}),
      ...(params.size !== undefined ? { size: String(params.size) } : {}),
    });
    return this.get<CmsWithdrawalSearchResponse>(`${this.apiUrl}/v1/cms/withdrawals?${query.toString()}`);
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      'X-SW-KEY': this.swKey,
      'X-CUST-KEY': this.custKey,
    };
  }

  private jsonHeaders(): Record<string, string> {
    return {
      ...this.authHeaders(),
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(url: string, body: Record<string, unknown>): Promise<CmsApiResult<T>> {
    this.logger.debug(`POST ${url}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async put<T>(url: string, body: Record<string, unknown>): Promise<CmsApiResult<T>> {
    this.logger.debug(`PUT ${url}`);
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  private async del<T>(url: string, body?: Record<string, unknown>): Promise<CmsApiResult<T>> {
    this.logger.debug(`DELETE ${url}`);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.jsonHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.handleResponse<T>(res);
  }

  private async get<T>(url: string, params?: Record<string, string>): Promise<CmsApiResult<T>> {
    let fullUrl = url;
    if (params && !url.includes('?')) {
      const query = new URLSearchParams(params);
      fullUrl = `${url}?${query.toString()}`;
    }
    this.logger.debug(`GET ${fullUrl}`);
    const res = await fetch(fullUrl, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<CmsApiResult<T>> {
    const body = await res.json().catch(() => ({ resultCode: 'UNKNOWN', resultMsg: 'Failed to parse response' }));

    if (res.ok && body.resultCode === '0000') {
      return { ok: true, data: body as T };
    }

    const error: CmsApiError = {
      code: body.resultCode ?? 'UNKNOWN',
      message: body.resultMsg ?? 'Unknown error',
    };
    this.logger.error(`CMS API error: ${res.status} ${JSON.stringify(error)}`);
    return { ok: false, error, statusCode: res.status };
  }
}
