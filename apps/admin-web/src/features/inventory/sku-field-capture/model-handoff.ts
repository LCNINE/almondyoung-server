import type {
  FieldCaptureDetailDto,
  Sku3dModelDto,
} from '@/lib/types/dto/inventory';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

export const GLB_MAX_BYTES = 2 * 1024 * 1024;
export const GLB_MIME = 'model/gltf-binary';

export function handoffBlockedReason(
  detail: FieldCaptureDetailDto
): string | null {
  if (detail.photos.length === 0) {
    return '찍은 사진이 없어요';
  }

  const measurements = [
    { name: '가로', value: detail.packageWidthMm },
    { name: '세로', value: detail.packageLengthMm },
    { name: '높이', value: detail.packageHeightMm },
    { name: '무게', value: detail.packageWeightG },
  ];
  const missing = measurements
    .filter(({ value }) => value === null || value === 0)
    .map(({ name }) => name);

  return missing.length > 0
    ? `실측 정보가 비어 있어요 (${missing.join(', ')})`
    : null;
}

export function buildModelPrompt(detail: FieldCaptureDetailDto): string {
  return `이 폴더의 ${detail.code}-1 ~ ${detail.code}-${detail.photos.length} 상품 사진 ${detail.photos.length}장과 실측 정보를 참고해
실제 외형을 재현한 3D 모델을 GLB 파일로 직접 만들어 줘.

상품명: ${detail.name}
SKU: ${detail.code}
가로: ${detail.packageWidthMm}mm
세로: ${detail.packageLengthMm}mm
높이: ${detail.packageHeightMm}mm
무게: ${detail.packageWeightG}g

조건:
1. 이미지 생성이나 외부 3D 생성 서비스를 쓰지 말고
   Python 코드로 메시를 직접 만들어.
2. 먼저 사진을 보고 상품의 실제 형태를 판단해.
   단순한 상자로 대체하지 말고, 사진에 보이는 몸체 형태,
   뚜껑·입구, 홈, 돌출부, 윗면·밑면 등 구조를 재현해.
   상자나 납작한 판처럼 실제로 단순한 상품은 그 형태 그대로 만들어.
3. 전체 외곽 치수는 ${detail.packageWidthMm}×${detail.packageLengthMm}×${detail.packageHeightMm}mm로 맞추고,
   GLB에는 미터 단위로 적용해. 무게는 메타데이터로 기록해.
4. 사진 방향은 실제 사진을 보고 판단해.
   라벨과 표면은 원본 사진을 상품 표면에 맞게 입히고,
   글자·로고·바코드를 다시 그리거나 수정하지 마.
5. 텍스처를 GLB 안에 포함하고, 저장하기 전에
   npx -y @gltf-transform/cli@4.2.1 optimize 원본.glb 결과.glb --compress meshopt --texture-compress webp
   로 압축해. 압축한 파일은 2MB 이하여야 해.
6. 치수, 글자 방향, 표면 겹침과 파일 오류를 확인해.
   사진만으로 추정한 세부 형상은 간단히 밝혀.
7. 결과는 이 폴더에 ${detail.code}.glb 와 Python 원본으로 저장해.
8. 미리보기는 이 폴더에 ${detail.code}-preview.html 한 파일로 만들어 브라우저로 열어 보여 줘.
   https://unpkg.com/@google/model-viewer@4/dist/model-viewer.min.js 의
   <model-viewer camera-controls> 를 쓰고, GLB 는 base64 data URI 로 HTML 안에 넣어.
   file:// 에서는 옆 파일을 불러오지 못하고, meshopt 압축 GLB 는 디코더 없는 three.js 로는 보이지 않아.
   공개 사이트로 게시하지 말고, 내가 수정을 요청하면 고쳐서 다시 저장해 줘.`;
}

export function chatGptAppUrl(folder: string, prompt: string): string {
  const url = new URL('codex://threads/new');

  url.searchParams.set('path', folder);
  url.searchParams.set('prompt', prompt);

  return url.toString();
}

export function photoUrlsOf(
  detail: FieldCaptureDetailDto,
  origin: string
): string[] {
  return [...detail.photos]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ fileId }) => new URL(resolvePublicFileUrl(fileId)!, origin).href);
}

export function glbFileProblem(file: {
  name: string;
  size: number;
}): string | null {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    return 'GLB 파일만 올릴 수 있어요';
  }

  if (file.size > GLB_MAX_BYTES) {
    return '2MB 이하 파일만 올릴 수 있어요. 압축한 GLB 를 올려 주세요';
  }

  return null;
}

export function asGlbFile(file: File): File {
  return new File([file], file.name, { type: GLB_MIME });
}

export function modelSummary(models: Sku3dModelDto[]): {
  publishedVersion: number | null;
  nextVersion: number;
} {
  const approved = models.filter(({ status }) => status === 'approved');

  return {
    publishedVersion:
      approved.length > 0
        ? Math.max(...approved.map(({ version }) => version))
        : null,
    nextVersion: Math.max(0, ...models.map(({ version }) => version)) + 1,
  };
}
