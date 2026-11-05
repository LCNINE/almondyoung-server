import type {
  FieldCaptureDetailDto,
  Sku3dModelDto,
} from '@/lib/types/dto/inventory';
import {
  asGlbFile,
  buildModelPrompt,
  chatGptAppUrl,
  GLB_MAX_BYTES,
  glbFileProblem,
  handoffBlockedReason,
  modelSummary,
  photoUrlsOf,
} from './model-handoff';

jest.mock('@/const/api-const', () => ({
  FILE_SERVICE_BASE_URL: '/api/proxy/file',
}));

function detail(
  overrides: Partial<FieldCaptureDetailDto> = {}
): FieldCaptureDetailDto {
  return {
    skuId: 'sku-1',
    code: 'SKU-1',
    name: '테스트 상품',
    imageUrl: null,
    positionCode: null,
    packageWidthMm: 120,
    packageLengthMm: 80,
    packageHeightMm: 45,
    packageWeightG: 210,
    barcodes: [],
    photos: [
      {
        id: 'p2',
        fileId: 'f2',
        sortOrder: 2,
        takenByLabel: '작업자',
        createdAt: '2026-11-03T00:00:00Z',
      },
      {
        id: 'p1',
        fileId: 'f1',
        sortOrder: 1,
        takenByLabel: '작업자',
        createdAt: '2026-11-03T00:00:00Z',
      },
    ],
    completion: null,
    ...overrides,
  };
}

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
  it('fills the prompt with values', () => {
    const p = buildModelPrompt(detail());

    expect(
      p.startsWith(
        '이 폴더의 SKU-1-1 ~ SKU-1-2 상품 사진 2장과 실측 정보를 참고해\n'
      )
    ).toBe(true);
    expect(p).toContain(
      '상품명: 테스트 상품\nSKU: SKU-1\n가로: 120mm\n세로: 80mm\n높이: 45mm\n무게: 210g'
    );
    expect(p).toContain('3. 전체 외곽 치수는 120×80×45mm로 맞추고,');
    expect(p).not.toMatch(/\{/);
  });

  it('preserves the complete prompt text and indentation', () => {
    expect(buildModelPrompt(detail()))
      .toBe(`이 폴더의 SKU-1-1 ~ SKU-1-2 상품 사진 2장과 실측 정보를 참고해
실제 외형을 재현한 3D 모델을 GLB 파일로 직접 만들어 줘.

상품명: 테스트 상품
SKU: SKU-1
가로: 120mm
세로: 80mm
높이: 45mm
무게: 210g

조건:
1. 이미지 생성이나 외부 3D 생성 서비스를 쓰지 말고
   Python 코드로 메시를 직접 만들어.
2. 먼저 사진을 보고 상품의 실제 형태를 판단해.
   단순한 상자로 대체하지 말고, 사진에 보이는 몸체 형태,
   뚜껑·입구, 홈, 돌출부, 윗면·밑면 등 구조를 재현해.
   상자나 납작한 판처럼 실제로 단순한 상품은 그 형태 그대로 만들어.
3. 전체 외곽 치수는 120×80×45mm로 맞추고,
   GLB에는 미터 단위로 적용해. 무게는 메타데이터로 기록해.
4. 사진 방향은 실제 사진을 보고 판단해.
   라벨과 표면은 원본 사진을 상품 표면에 맞게 입히고,
   글자·로고·바코드를 다시 그리거나 수정하지 마.
5. 텍스처를 GLB 안에 포함하고, 저장하기 전에
   npx -y @gltf-transform/cli@4.2.1 optimize 원본.glb 결과.glb --compress meshopt --texture-compress webp
   로 압축해. 압축한 파일은 2MB 이하여야 해.
6. 치수, 글자 방향, 표면 겹침과 파일 오류를 확인해.
   사진만으로 추정한 세부 형상은 간단히 밝혀.
7. 결과는 이 폴더에 SKU-1.glb 와 Python 원본으로 저장하고,
   드래그로 돌려 볼 수 있는 3D 미리보기를 열어 보여 줘.
   공개 사이트로 게시하지 말고, 내가 수정을 요청하면 고쳐서 다시 저장해 줘.`);
  });

  it('builds the ChatGPT app link with the folder and prompt', () => {
    const url = new URL(
      chatGptAppUrl('/Users/me/Downloads', '첫 줄\n둘째 줄 & 기호')
    );

    expect(url.protocol).toBe('codex:');
    expect(url.host).toBe('threads');
    expect(url.pathname).toBe('/new');
    expect(url.searchParams.get('path')).toBe('/Users/me/Downloads');
    expect(url.searchParams.get('prompt')).toBe('첫 줄\n둘째 줄 & 기호');
  });

  it('blocks when no photos', () => {
    expect(
      handoffBlockedReason(detail({ photos: [], packageWidthMm: null }))
    ).toBe('찍은 사진이 없어요');
  });

  it('names missing measurements, zero counts as missing', () => {
    expect(
      handoffBlockedReason(detail({ packageWidthMm: null, packageWeightG: 0 }))
    ).toBe('실측 정보가 비어 있어요 (가로, 무게)');
  });

  it('names all missing measurements in width, length, height, weight order', () => {
    expect(
      handoffBlockedReason(
        detail({
          packageWidthMm: 0,
          packageLengthMm: null,
          packageHeightMm: 0,
          packageWeightG: null,
        })
      )
    ).toBe('실측 정보가 비어 있어요 (가로, 세로, 높이, 무게)');
  });

  it('passes complete detail', () => {
    expect(handoffBlockedReason(detail())).toBeNull();
  });

  it('orders photo urls by sortOrder as absolute urls without mutating photos', () => {
    const d = detail();

    expect(photoUrlsOf(d, 'http://localhost:8002')).toEqual([
      'http://localhost:8002/api/proxy/file/files/public/f1',
      'http://localhost:8002/api/proxy/file/files/public/f2',
    ]);
    expect(d.photos.map((photo) => photo.fileId)).toEqual(['f2', 'f1']);
  });

  it('returns no urls for no photos', () => {
    expect(
      photoUrlsOf(detail({ photos: [] }), 'http://localhost:8002')
    ).toEqual([]);
  });

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
