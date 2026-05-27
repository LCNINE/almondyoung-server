'use client';

import { USER_SERVICE_BASE_URL } from '@/const/api-const';
import {
  BusinessLicenseDto,
  BusinessLicenseListQuery,
  BusinessLicenseListResponse,
  BusinessLicenseUpdateDto,
} from '@/lib/types/dto/business-licenses';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

function buildQueryString(query: BusinessLicenseListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const businessLicensesApi = {
  getBusinessLicenses: async (
    query: BusinessLicenseListQuery
  ): Promise<BusinessLicenseListResponse> => {
    const qs = buildQueryString(query);
    const response: AxiosResponse<BusinessLicenseListResponse> =
      await client.get(
        `${USER_SERVICE_BASE_URL}/admin/business-licenses${qs ? `?${qs}` : ''}`
      );
    return response.data;
  },

  getBusinessLicense: async (id: string): Promise<BusinessLicenseDto> => {
    const response: AxiosResponse<BusinessLicenseDto> = await client.get(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/${id}`
    );
    return response.data;
  },

  updateBusinessLicense: async (
    businessId: string,
    dto: BusinessLicenseUpdateDto
  ): Promise<void> => {
    await client.put(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/${businessId}`,
      dto
    );
  },

  deleteBusinessLicense: async (id: string): Promise<void> => {
    await client.delete(
      `${USER_SERVICE_BASE_URL}/admin/business-licenses/${id}`
    );
  },
};
