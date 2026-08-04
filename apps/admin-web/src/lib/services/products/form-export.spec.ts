import { formExportRefetchInterval, isFormExportRunning } from './form-export';

// form-export.ts 는 products.formExport 를 통해 '@/lib/api/domains' 를 런타임에
// import 한다. 이 별칭은 admin-web 자체 tsconfig 에만 있고 루트 jest 설정(이 spec 을
// 포함해 apps/ 아래 모든 *.spec.ts 를 수집)의 moduleNameMapper 에는 없어 실제 모듈을
// 못 찾는다 — queries.spec.ts 의 선례를 그대로 따라 virtual mock 으로 우회한다.
jest.mock(
  '@/lib/api/domains',
  () => ({
    products: {
      formExport: {
        request: jest.fn(),
        getStatus: jest.fn(),
        getDownloadUrl: jest.fn(),
      },
    },
  }),
  { virtual: true }
);

describe('formExportRefetchInterval', () => {
  it('데이터가 아직 없으면 계속 두드린다', () => {
    expect(formExportRefetchInterval(undefined)).toBe(2000);
  });

  it('진행 중이면 폴링한다', () => {
    expect(formExportRefetchInterval({ status: 'running' } as never)).toBe(
      2000
    );
    expect(formExportRefetchInterval({ status: 'queued' } as never)).toBe(2000);
  });

  it('완료·실패면 폴링을 멈춘다', () => {
    expect(formExportRefetchInterval({ status: 'completed' } as never)).toBe(
      false
    );
    expect(formExportRefetchInterval({ status: 'failed' } as never)).toBe(
      false
    );
  });
});

describe('isFormExportRunning', () => {
  it('알 수 없는 상태는 진행 중으로 본다 — 접수 직후 첫 응답 전에 화면이 굳지 않게', () => {
    expect(isFormExportRunning(undefined)).toBe(true);
  });

  it('queued/running 은 진행 중', () => {
    expect(isFormExportRunning('queued')).toBe(true);
    expect(isFormExportRunning('running')).toBe(true);
  });

  it('completed/failed 는 진행 중이 아니다', () => {
    expect(isFormExportRunning('completed')).toBe(false);
    expect(isFormExportRunning('failed')).toBe(false);
  });
});
