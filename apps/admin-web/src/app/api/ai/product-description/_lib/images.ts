const FILE_SERVICE_URL =
  process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';

/**
 * 한 번의 Claude 호출에 넣는 이미지 장수. Claude API 는 한 요청에 이미지가 20장을
 * 넘으면 장당 해상도 제한이 더 엄격해지므로 그 아래로 묶는다. 이 값이 곧 추출 단계의
 * 호출 단위이고, 호출 하나의 소요 시간을 결정한다.
 */
export const IMAGES_PER_CHUNK = 8;

/**
 * 서버에서 이미지를 축소하지 않는다. Claude 는 긴 변이 2576px 를 넘으면 알아서 줄여서
 * 처리하고, 청크가 8장이라 20장 초과 시 걸리는 해상도 제한도 해당 없다. 미리 줄여 아끼는
 * 토큰은 장당 900 개 남짓(30장에 $0.1 미만)이라 sharp 를 안고 갈 값어치가 없다 —
 * 네이티브 바이너리라 배포 플랫폼(linux)과 개발 머신(darwin)이 어긋나면 런타임에 터진다.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * Claude API 는 요청 전체가 32MB 를 넘으면 거부한다. base64 는 원본의 약 1.37배라
 * 원본 합계는 20MB 아래로 묶는다. 청크 단위로 적용되므로 전체 장수와 무관하다.
 */
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export type LoadedImage = {
  fileId: string;
  mediaType: SupportedMediaType;
  data: string;
  bytes: number;
};

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * S3 로 302 리다이렉트되면 content-type 이 octet-stream 으로 오는 경우가 있어
 * 헤더를 못 믿는다. 파일 시그니처(매직 바이트)로 실제 형식을 판별한다.
 */
function sniffMediaType(buffer: Buffer): SupportedMediaType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
    return 'image/png';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function loadImage(fileId: string): Promise<LoadedImage> {
  const res = await fetch(
    `${FILE_SERVICE_URL.replace(/\/+$/, '')}/files/public/${encodeURIComponent(fileId)}`
  );
  if (!res.ok) {
    throw new Error(
      `이미지를 불러오지 못했습니다. (fileId: ${fileId}, status: ${res.status})`
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const headerType = (res.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim();
  const mediaType = isSupportedMediaType(headerType)
    ? headerType
    : sniffMediaType(buffer);

  if (!mediaType) {
    throw new Error(
      `지원하지 않는 이미지 형식입니다. (fileId: ${fileId}, type: ${headerType || '알 수 없음'})`
    );
  }

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    const mb = (buffer.byteLength / 1024 / 1024).toFixed(1);
    throw new Error(
      `이미지 한 장이 너무 큽니다. (${mb}MB — 장당 5MB 이하) 용량을 줄여 다시 올려주세요.`
    );
  }

  return {
    fileId,
    mediaType,
    data: buffer.toString('base64'),
    bytes: buffer.byteLength,
  };
}

export async function loadImageChunk(
  fileIds: string[]
): Promise<LoadedImage[]> {
  const images = await Promise.all(fileIds.map(loadImage));

  const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
  if (totalBytes > MAX_CHUNK_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      `이미지 ${images.length}장 합계가 너무 큽니다. (${mb}MB — 합계 20MB 이하) 용량을 줄여 다시 올려주세요.`
    );
  }

  return images;
}

export function toImageBlocks(images: LoadedImage[]) {
  return images.map((image) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: image.mediaType,
      data: image.data,
    },
  }));
}
