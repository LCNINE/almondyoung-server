import type { Sku3dModelDto } from '@/lib/types/dto/inventory';
import { asGlbFile, GLB_MAX_BYTES, glbFileProblem, modelSummary } from './model-handoff';

jest.mock('@/const/api-const', () => ({
  FILE_SERVICE_BASE_URL: '/api/proxy/file',
}));

function m(version: number, status: Sku3dModelDto['status']): Sku3dModelDto {
  return {
    id: `model-${version}`,
    skuId: 'sku-1',
    version,
    glbFileId: status === 'approved' ? `glb-${version}` : null,
    status,
    createdAt: '2026-11-03T00:00:00Z',
  };
}

describe('model handoff', () => {
  it('accepts uppercase .GLB, rejects others and oversize', () => {
    expect(glbFileProblem({ name: 'a.GLB', size: 10 })).toBeNull();
    expect(glbFileProblem({ name: 'a.gltf', size: 10 })).toBe(
      'GLB 파일만 올릴 수 있어요'
    );
    expect(glbFileProblem({ name: 'a.glb', size: GLB_MAX_BYTES + 1 })).toBe(
      '2MB 이하 파일만 올릴 수 있어요. 압축한 GLB 를 올려 주세요'
    );
  });

  it('accepts exactly 2 MiB and checks the extension first', () => {
    expect(
      glbFileProblem({ name: 'a.glb', size: 2 * 1024 * 1024 })
    ).toBeNull();
    expect(glbFileProblem({ name: 'a.glb.zip', size: GLB_MAX_BYTES + 1 })).toBe(
      'GLB 파일만 올릴 수 있어요'
    );
    expect(glbFileProblem({ name: 'glb', size: 10 })).toBe(
      'GLB 파일만 올릴 수 있어요'
    );
  });

  it('forces the glb mime type while preserving the name and bytes', async () => {
    const f = asGlbFile(new File(['x'], 'a.glb', { type: '' }));

    expect(f.type).toBe('model/gltf-binary');
    expect(f.name).toBe('a.glb');
    expect(await f.text()).toBe('x');
  });

  it('summarises versions regardless of array order', () => {
    expect(modelSummary([])).toEqual({
      publishedVersion: null,
      nextVersion: 1,
    });
    expect(
      modelSummary([m(1, 'approved'), m(3, 'failed'), m(2, 'approved')])
    ).toEqual({
      publishedVersion: 2,
      nextVersion: 4,
    });
    expect(
      modelSummary([m(3, 'approved'), m(2, 'approved'), m(1, 'approved')])
    ).toEqual({
      publishedVersion: 3,
      nextVersion: 4,
    });
  });

  it('uses every status for the next version without publishing unapproved models', () => {
    expect(
      modelSummary([
        m(4, 'failed'),
        m(7, 'needs_more_photos'),
        m(6, 'needs_revision'),
      ])
    ).toEqual({
      publishedVersion: null,
      nextVersion: 8,
    });
  });
});
