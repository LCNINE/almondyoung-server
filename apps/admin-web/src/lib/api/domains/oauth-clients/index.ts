'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
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
    const res = await client.get<OAuthClientResponse[]>(base);
    return res.data;
  },

  get: async (clientId: string): Promise<OAuthClientResponse> => {
    const res = await client.get<OAuthClientResponse>(
      `${base}/${encodeURIComponent(clientId)}`,
    );
    return res.data;
  },

  create: async (dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponse> => {
    const res = await client.post<OAuthClientWithSecretResponse>(base, dto);
    return res.data;
  },

  update: async (clientId: string, dto: UpdateOAuthClientDto): Promise<OAuthClientResponse> => {
    const res = await client.patch<OAuthClientResponse>(
      `${base}/${encodeURIComponent(clientId)}`,
      dto,
    );
    return res.data;
  },

  rotateSecret: async (clientId: string): Promise<OAuthClientWithSecretResponse> => {
    const res = await client.post<OAuthClientWithSecretResponse>(
      `${base}/${encodeURIComponent(clientId)}/rotate-secret`,
    );
    return res.data;
  },

  clearPreviousSecret: async (clientId: string): Promise<OAuthClientResponse> => {
    const res = await client.post<OAuthClientResponse>(
      `${base}/${encodeURIComponent(clientId)}/clear-previous-secret`,
    );
    return res.data;
  },

  deactivate: async (clientId: string): Promise<OAuthClientResponse> => {
    const res = await client.delete<OAuthClientResponse>(
      `${base}/${encodeURIComponent(clientId)}`,
    );
    return res.data;
  },
};
