// 디지털 자산 / 라이브러리 도메인 DTO

export interface DigitalAssetFileVersionDto {
  id: string;
  assetId: string;
  version: number;
  fileId: string;
  releaseNote?: string | null;
  releasedAt: string;
  releasedBy?: string | null;
}

export interface DigitalAssetDto {
  id: string;
  name: string;
  description?: string | null;
  mimeType?: string | null;
  thumbnailUrl?: string | null;
  currentFileVersionId?: string | null;
  currentFileVersion?: DigitalAssetFileVersionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface DigitalAssetListResponse {
  data: DigitalAssetDto[];
  total: number;
  page: number;
  limit: number;
}

export interface DigitalAssetListQuery {
  q?: string;
  page?: number;
  limit?: number;
}

export interface CreateDigitalAssetDto {
  name: string;
  description?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  initialFileId?: string;
  initialReleaseNote?: string;
}

export interface UpdateDigitalAssetDto {
  name?: string;
  description?: string;
  mimeType?: string;
  thumbnailUrl?: string;
}

export interface CreateFileVersionDto {
  fileId: string;
  releaseNote?: string;
}

export interface SetVariantAssetLinksDto {
  assetIds: string[];
}
