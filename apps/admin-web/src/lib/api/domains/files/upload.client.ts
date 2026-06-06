'use client';

import { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID } from '@packages/product-description';

// file-service 업로드 클라이언트.
// 주의: axios `client`(baseURL='/api') 대신 fetch 절대경로를 쓴다.
// FILE_SERVICE_BASE_URL(브라우저)이 이미 '/api/proxy/file' 라서 axios 로 보내면
// baseURL 이 중복되어 '/api/api/proxy/file/...' 가 된다. 또 file-service 는 envelope
// 없이 raw JSON 을 반환하므로 client 의 unwrap 인터셉터도 불필요하다.

export type FileUploadResponse = {
  id: string;
  url: string;
  fileName: string;
  size: number;
  status: string;
  isPublic: boolean;
};

export type FileSignedUrlResponse = {
  signedUrl: string;
  expiresAt: string;
};

export const DIGITAL_ASSET_FILE_CONTEXT_ID = 'digital-asset-file';
export { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID };

type UploadFileOptions = {
  contextId: string;
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
};

export async function uploadFileToFileService(
  file: File,
  { contextId, isPublic, metadata }: UploadFileOptions
): Promise<FileUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('contextId', contextId);
  if (isPublic !== undefined) {
    formData.append('isPublic', String(isPublic));
  }
  if (metadata !== undefined) {
    formData.append('metadata', JSON.stringify(metadata));
  }

  const res = await fetch('/api/proxy/file/files/upload', {
    method: 'POST',
    body: formData, // Content-Type(multipart boundary)은 브라우저가 자동 설정 — 직접 지정 금지
    credentials: 'include', // 인증 쿠키 → forward.ts 가 file-service 로 전달
  });

  if (!res.ok) {
    throw new Error(`파일 업로드에 실패했습니다. (status: ${res.status})`);
  }

  return (await res.json()) as FileUploadResponse;
}

/**
 * 리치 텍스트 본문 이미지를 file-service 에 업로드하고 공개 URL 을 반환한다.
 * contextId 는 해당 도메인의 file_contexts 시드(예: notice-content-image)와 일치해야 한다.
 */
export async function uploadRichTextImage(
  file: File,
  contextId: string
): Promise<FileUploadResponse> {
  return uploadFileToFileService(file, { contextId, isPublic: true });
}

export async function getFileSignedUrlFromFileService(
  fileId: string,
  expiresIn = 300
): Promise<FileSignedUrlResponse> {
  const res = await fetch(
    `/api/proxy/file/files/${encodeURIComponent(fileId)}/download?expiresIn=${expiresIn}`,
    {
      method: 'GET',
      credentials: 'include',
    }
  );

  if (!res.ok) {
    throw new Error(`파일 URL 생성에 실패했습니다. (status: ${res.status})`);
  }

  return (await res.json()) as FileSignedUrlResponse;
}
