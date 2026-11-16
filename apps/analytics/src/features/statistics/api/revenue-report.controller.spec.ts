import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard, PermissionGuard } from '@app/authorization';
import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization/decorators/require-permission.decorator';
import { RevenueReportManager } from '../read-model/revenue-report.manager';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportExternalRevenueDto, RevenueRawQueryDto, RevenueReportController } from './revenue-report.controller';

const row = {
  channel: 'coupang',
  account: '중개',
  month: '2026-01',
  basis: 'purchase_confirmed',
  amount: 123,
  source: '월별자료',
};

describe('매출 취합 입력 검증', () => {
  it('잘못된 연도와 페이지를 거부한다', async () => {
    expect(await validate(plainToInstance(RevenueRawQueryDto, { year: 2026, page: 0 }))).toHaveLength(0);
    expect((await validate(plainToInstance(RevenueRawQueryDto, { year: 0, page: -1 }))).length).toBeGreaterThan(0);
  });

  it('배열 내부 행까지 검증한다', async () => {
    expect(await validate(plainToInstance(ImportExternalRevenueDto, { rows: [row] }))).toHaveLength(0);
    expect(
      (await validate(plainToInstance(ImportExternalRevenueDto, { rows: [{ ...row, amount: 1.5 }] }))).length,
    ).toBeGreaterThan(0);
  });

  it('중복 행과 공백 출처는 저장 전에 차단한다', () => {
    const service = { import: jest.fn() };
    const manager = new RevenueReportManager(service as never);
    expect(() => manager.import([{ ...row }, { ...row }])).toThrow();
    expect(() => manager.import([{ ...row, source: ' ' }])).toThrow();
    expect(service.import).not.toHaveBeenCalled();
  });
});

describe('카페24·대조 상태 입력', () => {
  it('운영 순매출과 허용된 상태만 받는다', async () => {
    const cafe = {
      ...row,
      channel: 'cafe24',
      basis: 'operational_net',
      originalStatus: 'confirmed',
      reviewNote: '원본 대조 근거',
    };
    expect(await validate(plainToInstance(ImportExternalRevenueDto, { rows: [cafe] }))).toHaveLength(0);
    expect(
      (await validate(plainToInstance(ImportExternalRevenueDto, { rows: [{ ...cafe, monthlyStatus: 'done' }] })))
        .length,
    ).toBeGreaterThan(0);
  });
  it('근거 없는 확인을 막고 인증된 반영자를 서비스로 전달한다', () => {
    const service = { import: jest.fn() };
    const controller = new RevenueReportController(service as never);
    const manager = new RevenueReportManager(service as never);
    expect(() => manager.import([{ ...row, originalStatus: 'confirmed' }])).toThrow();
    controller.import({ rows: [{ ...row }] }, { userId: 'test-operator' });
    expect(service.import).toHaveBeenCalledWith([{ ...row }], 'test-operator', undefined);
  });
});

describe('매출 자료 권한', () => {
  it('모든 경로에 인증·권한 가드를 유지한다', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RevenueReportController)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(['get', 'history', 'raw'] as const)('%s 조회는 통계 조회 권한을 요구한다', (method) => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, RevenueReportController.prototype[method])).toEqual([
      'analytics.report.read',
    ]);
  });

  it('등록은 조회 권한보다 강한 설정 권한을 요구한다', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, RevenueReportController.prototype.import)).toEqual([
      'analytics.setting.write',
    ]);
  });

  it('반영 이력은 검증된 연도만 서비스에 전달한다', () => {
    const service = { history: jest.fn().mockReturnValue([]) };
    const controller = new RevenueReportController(service as never);
    controller.history({ year: 2026 });
    expect(service.history).toHaveBeenCalledWith(2026);
  });
});
