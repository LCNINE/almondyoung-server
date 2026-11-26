import type { Sku3dModelDto } from '@/lib/types/dto/inventory';

export const GLB_MAX_BYTES = 2 * 1024 * 1024;
export const GLB_MIME = 'model/gltf-binary';

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
