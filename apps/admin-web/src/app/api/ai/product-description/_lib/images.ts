import sharp from 'sharp';

const FILE_SERVICE_URL =
  process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';

/**
 * 한 번의 Claude 호출에 넣는 이미지 장수. Claude API 는 한 요청에 이미지가 20장을
 * 넘으면 장당 해상도 제한이 더 엄격해지므로 그 아래로 묶는다. 이 값이 곧 추출 단계의
 * 호출 단위이고, 호출 하나의 소요 시간을 결정한다.
 */
export const IMAGES_PER_CHUNK = 8;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * Claude API 는 요청 전체가 32MB 를 넘으면 거부한다. base64 는 원본의 약 1.37배라
 * 원본 합계는 20MB 아래로 묶는다. 청크 단위로 적용되므로 전체 장수와 무관하다.
 */
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;
/**
 * Claude API 는 **8000x8000px 를 넘는 이미지를 거부한다(400)**. 상품 상세 이미지는
 * 세로로 아주 길어(예: 860x12000) 이 한도를 쉽게 넘으므로 보내기 전에 반드시 줄인다.
 * 8000px 이하는 Claude 가 알아서 축소하지만 초과분은 축소가 아니라 거절이다.
 * 2000px 는 스펙표의 작은 글씨까지 읽히면서 용량은 감당되는 선.
 */
const MAX_IMAGE_EDGE = 2000;

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

/**
 * 긴 변이 MAX_IMAGE_EDGE 를 넘거나 장당 한도를 넘으면 축소한다.
 * 축소가 필요한 경우에만 JPEG 로 재인코딩 — 그대로 통과하는 이미지는 원본 화질을 지킨다.
 */
async function shrinkIfNeeded(
  buffer: Buffer,
  mediaType: SupportedMediaType
): Promise<{ buffer: Buffer; mediaType: SupportedMediaType }> {
  const image = sharp(buffer, { animated: false });
  const meta = await image.metadata();
  const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

  if (longestEdge <= MAX_IMAGE_EDGE && buffer.byteLength <= MAX_IMAGE_BYTES) {
    return { buffer, mediaType };
  }

  const resized = await image
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { buffer: resized, mediaType: 'image/jpeg' };
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

  // 원본이 크면 서버에서 줄인다 — 어드민이 이미지를 미리 손보게 만들지 않기 위해서.
  const normalized = await shrinkIfNeeded(buffer, mediaType);
  if (normalized.buffer.byteLength > MAX_IMAGE_BYTES) {
    const mb = (normalized.buffer.byteLength / 1024 / 1024).toFixed(1);
    throw new Error(
      `이미지가 너무 큽니다. (fileId: ${fileId}, 축소 후에도 ${mb}MB)`
    );
  }

  return {
    fileId,
    mediaType: normalized.mediaType,
    data: normalized.buffer.toString('base64'),
    bytes: normalized.buffer.byteLength,
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
