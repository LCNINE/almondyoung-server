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
//
// 업로드는 presign → 스토리지 직접 PUT → confirm 3단계가 기본 경로다. 파일 본문이
// 프록시(Lambda, 실효 ~4.7MB 상한)를 지나지 않아 컨텍스트 상한(10MB~)까지 올라간다.
// 직접 경로가 성립하지 않으면(구버전 서버 404, CORS 미적용, 네트워크) 기존 프록시
// multipart 업로드로 폴백한다 — 단 프록시 상한을 넘는 파일은 폴백할 수 없다.

/**
 * 관리자 이미지 컨텍스트(banner/category/notice/product image)의 서버 상한.
 * file_contexts 시드(default-file-contexts.ts)의 10485760 과 같은 값 — 업로드 전
 * 안내 문구·선제 차단용이고, 실제 검증은 서버(presign/confirm)가 한다.
 */
export const IMAGE_CONTEXT_MAX_BYTES = 10 * 1024 * 1024;

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
export const ARCHIVE_PAGE_IMAGE_CONTEXT_ID = 'archive-page-image';
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

/**
 * 서버가 검증으로 거부한 업로드(컨텍스트 상한 초과, 허용 안 된 타입 등).
 * 프록시로 다시 보내도 같은 검증에 걸리므로 폴백하지 않고 그대로 띄운다.
 */
class UploadRejectedError extends Error {}

async function readServerErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(', ');
  } catch {
    // JSON 이 아니면 상태코드 기반 문구로
  }
  return null;
}

async function rejectionFrom(res: Response, fallback: string): Promise<UploadRejectedError> {
  const message = await readServerErrorMessage(res);
  return new UploadRejectedError(message ? `파일 업로드가 거부되었습니다. (${message})` : fallback);
}

type PresignResponse = {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

async function uploadDirect(
  file: File,
  { contextId, isPublic, metadata }: Omit<UploadFileOptions, 'compress'>
): Promise<FileUploadResponse> {
  const presignRes = await fetchWithRefresh('/api/proxy/file/files/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      contextId,
      fileName: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      ...(isPublic !== undefined ? { isPublic } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    }),
  });

  if (!presignRes.ok) {
    // 400/403 은 검증 거부. 404(구버전 서버·직접 업로드 미지원)와 5xx·네트워크는
    // 호출부에서 프록시 업로드로 폴백한다.
    if (presignRes.status === 400 || presignRes.status === 403) {
      throw await rejectionFrom(presignRes, `파일 업로드가 거부되었습니다. (status: ${presignRes.status})`);
    }
    throw new Error(`presign failed (status: ${presignRes.status})`);
  }

  const presign = (await presignRes.json()) as PresignResponse;

  // 스토리지 직접 PUT — 프록시·인증 쿠키와 무관한 외부 요청이라 raw fetch 를 쓴다.
  // headers 는 서명에 포함돼 있어 그대로 실어야 한다.
  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
  });

  if (!putRes.ok) {
    throw new Error(`direct upload PUT failed (status: ${putRes.status})`);
  }

  const confirmRes = await fetchWithRefresh('/api/proxy/file/files/upload/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ fileId: presign.fileId }),
  });

  if (!confirmRes.ok) {
    if (confirmRes.status === 400 || confirmRes.status === 403) {
      throw await rejectionFrom(confirmRes, `파일 업로드가 거부되었습니다. (status: ${confirmRes.status})`);
    }
    throw new Error(`confirm failed (status: ${confirmRes.status})`);
  }

  return (await confirmRes.json()) as FileUploadResponse;
}

async function uploadViaProxy(
  file: File,
  { contextId, isPublic, metadata }: Omit<UploadFileOptions, 'compress'>
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

export async function uploadFileToFileService(
  file: File,
  { contextId, isPublic, metadata, compress }: UploadFileOptions
): Promise<FileUploadResponse> {
  let toUpload = file;
  if (compress !== false) {
    ({ file: toUpload } = await compressImageForUpload(file, compress));
  }

  try {
    return await uploadDirect(toUpload, { contextId, isPublic, metadata });
  } catch (e) {
    if (e instanceof UploadRejectedError) {
      throw e;
    }

    // 직접 경로가 안 되고(구버전 서버, CORS 미적용, 일시 장애) 프록시 상한도 넘는
    // 크기면 폴백조차 불가능하다 — 상태코드 대신 무엇을 해야 하는지 알려준다.
    // 호출부 catch 가 message 를 그대로 띄운다.
    if (toUpload.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `파일 업로드에 실패했습니다 (${formatBytes(toUpload.size)}). 잠시 후 다시 시도하고, 계속 실패하면 ${
          isCompressible(toUpload.type) ? '이미지를' : '파일을'
        } ${formatBytes(MAX_UPLOAD_BYTES)} 이하로 줄여서 올려주세요.`
      );
    }

    return uploadViaProxy(toUpload, { contextId, isPublic, metadata });
  }
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
