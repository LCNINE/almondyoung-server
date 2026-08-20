'use client';

import { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID } from '@packages/product-description';
import { fetchWithRefresh } from '../../fetch-with-refresh';
import {
  MAX_UPLOAD_BYTES,
  compressImageForUpload,
  formatBytes,
  isCompressible,
  type CompressOptions,
} from '@/lib/utils/image-compress';

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
export const PRODUCT_IMAGE_CONTEXT_ID = 'product-image';
export const CATEGORY_IMAGE_CONTEXT_ID = 'category-image';
export const BANNER_IMAGE_CONTEXT_ID = 'banner-image';
// 팝업은 공지 계열이라 공지 본문 이미지 컨텍스트를 그대로 쓴다. 정책(공개/이미지/10MB)이
// 같은데 전용 컨텍스트를 새로 만들면 시드가 밀린 환경에서 업로드가 404 로 죽는다.
export const SITE_POPUP_IMAGE_CONTEXT_ID = 'notice-content-image';
export const SHOP_LISTING_IMAGE_CONTEXT_ID = 'notice-content-image';
export { PRODUCT_DESCRIPTION_IMAGE_CONTEXT_ID };

type UploadFileOptions = {
  contextId: string;
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
  /**
   * 업로드 전 무손실 webp 변환. 기본은 변환한다 — 새 업로드 화면이 생겨도 여기서
   * 자동으로 걸리게 하려는 것. 파일 자체가 상품이거나(디지털 자산) 호출부가 이미
   * 변환을 마친 경우에만 false 로 끈다. 비이미지·GIF·SVG 는 옵션과 무관하게 원본
   * 그대로 나간다.
   */
  compress?: CompressOptions | false;
};

export async function uploadFileToFileService(
  file: File,
  { contextId, isPublic, metadata, compress }: UploadFileOptions
): Promise<FileUploadResponse> {
  let toUpload = file;
  if (compress !== false) {
    ({ file: toUpload } = await compressImageForUpload(file, compress));

    // 변환하고도 상한을 넘으면 프록시(Lambda)가 413 으로 끊는다. 상태코드 대신
    // 무엇을 해야 하는지 알려준다. 호출부 catch 가 message 를 그대로 띄운다.
    if (isCompressible(file.type) && toUpload.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `이미지가 너무 큽니다 (${formatBytes(toUpload.size)}). ${formatBytes(MAX_UPLOAD_BYTES)} 이하로 줄여서 올려주세요.`
      );
    }
  }

  const formData = new FormData();
  formData.append('file', toUpload);
  formData.append('contextId', contextId);
  if (isPublic !== undefined) {
    formData.append('isPublic', String(isPublic));
  }
  if (metadata !== undefined) {
    formData.append('metadata', JSON.stringify(metadata));
  }

  const res = await fetchWithRefresh('/api/proxy/file/files/upload', {
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
  expiresIn = 300,
  { forceDownload = false }: { forceDownload?: boolean } = {}
): Promise<FileSignedUrlResponse> {
  const res = await fetchWithRefresh(
    `/api/proxy/file/files/${encodeURIComponent(fileId)}/download?expiresIn=${expiresIn}${
      forceDownload ? '&download=true' : ''
    }`,
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
