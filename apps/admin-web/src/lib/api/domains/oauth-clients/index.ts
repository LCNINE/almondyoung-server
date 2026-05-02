import { USER_SERVICE_BASE_URL } from '@/const';
import { ApiResponse } from '@/lib/types/dto/api';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

export type OAuthClientType = 'confidential' | 'public';

export interface OAuthClientResponse {
  clientId: string;
  clientType: OAuthClientType;
  redirectUris: string[];
  postLogoutRedirectUris: string[] | null;
  allowedScopes: string[] | null;
  isActive: boolean;
  hasPreviousSecret: boolean;
  secretRotatedAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthClientWithSecretResponse extends OAuthClientResponse {
  clientSecret: string | null;
}

export interface CreateOAuthClientDto {
  clientId: string;
  clientType?: OAuthClientType;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes?: string[];
}

export interface UpdateOAuthClientDto {
  redirectUris?: string[];
  postLogoutRedirectUris?: string[];
  allowedScopes?: string[];
  isActive?: boolean;
}

const base = `${USER_SERVICE_BASE_URL}/admin/oauth-clients`;

export const oauthClientApi = {
  list: async (): Promise<OAuthClientResponse[]> => {
    const res: AxiosResponse<ApiResponse<OAuthClientResponse[]>> = await client.get(base);
    return res.data.data;
  },

  get: async (clientId: string): Promise<OAuthClientResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientResponse>> = await client.get(
      `${base}/${encodeURIComponent(clientId)}`,
    );
    return res.data.data;
  },

  create: async (dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientWithSecretResponse>> = await client.post(base, dto);
    return res.data.data;
  },

  update: async (clientId: string, dto: UpdateOAuthClientDto): Promise<OAuthClientResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientResponse>> = await client.patch(
      `${base}/${encodeURIComponent(clientId)}`,
      dto,
    );
    return res.data.data;
  },

  rotateSecret: async (clientId: string): Promise<OAuthClientWithSecretResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientWithSecretResponse>> = await client.post(
      `${base}/${encodeURIComponent(clientId)}/rotate-secret`,
    );
    return res.data.data;
  },

  clearPreviousSecret: async (clientId: string): Promise<OAuthClientResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientResponse>> = await client.post(
      `${base}/${encodeURIComponent(clientId)}/clear-previous-secret`,
    );
    return res.data.data;
  },

  deactivate: async (clientId: string): Promise<OAuthClientResponse> => {
    const res: AxiosResponse<ApiResponse<OAuthClientResponse>> = await client.delete(
      `${base}/${encodeURIComponent(clientId)}`,
    );
    return res.data.data;
  },
};
