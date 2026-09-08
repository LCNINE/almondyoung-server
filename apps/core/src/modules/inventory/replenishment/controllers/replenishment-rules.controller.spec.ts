import { createGlobalValidationPipe } from '../../../../platform/http/validation-pipe';
import { UpdateGradeRulesDto, UpsertSkuOverrideDto } from '../dto/replenishment-rules.dto';
import { ReplenishmentRulesController } from './replenishment-rules.controller';
import { ReplenishmentRulesService } from '../rules/replenishment-rules.service';

describe('ReplenishmentRulesController', () => {
  const service = {
    updateGrades: jest.fn().mockResolvedValue({ items: [] }),
    listSkuOverrides: jest.fn().mockResolvedValue({ items: [] }),
    upsertRoute: jest.fn().mockResolvedValue({}),
    deleteRoute: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReplenishmentRulesService;
  const controller = new ReplenishmentRulesController(service);

  it('등급 PUT 은 items 배열을 넘긴다', async () => {
    await controller.updateGrades({
      items: [
        { grade: 'A', alpha: 0.02 },
        { grade: 'B', alpha: 0.05 },
        { grade: 'C', alpha: 0.1 },
      ],
    });
    expect(service.updateGrades).toHaveBeenCalledWith([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  });

  it('SKU 예외 목록 limit 기본 100', async () => {
    await controller.listSkuOverrides({});
    expect(service.listSkuOverrides).toHaveBeenCalledWith(undefined, 100);
    await controller.listSkuOverrides({ q: 'abc', limit: 5 });
    expect(service.listSkuOverrides).toHaveBeenCalledWith('abc', 5);
  });

  it('경로 PUT · DELETE 는 (from, to) 를 순서대로 넘긴다', async () => {
    await controller.upsertRoute('w1', 'w2', { leadTimeDays: 9, coverDays: 10 });
    expect(service.upsertRoute).toHaveBeenCalledWith('w1', 'w2', { leadTimeDays: 9, coverDays: 10 });
    await controller.deleteRoute('w1', 'w2');
    expect(service.deleteRoute).toHaveBeenCalledWith('w1', 'w2');
  });

  /**
   * α = 0 · α = 1 은 정규 · 감마 분위수가 정의되지 않는 점이라 `policy/distributions.ts` 가
   * Error 를 던진다 — 막지 않으면 500 이 된다. 사람이 α 를 넣는 경로는 이 컨트롤러의 PUT 둘뿐이라
   * 배포와 같은 전역 파이프를 실제로 태워 400 을 고정한다(통합 스펙에도 같은 경계가 있지만
   * 그쪽은 DB 가 없으면 통째로 skip 된다).
   */
  describe('전역 ValidationPipe: α 는 (0, 1) 배타', () => {
    const pipe = createGlobalValidationPipe();
    const grades = (alpha: number) => ({
      items: [
        { grade: 'A', alpha },
        { grade: 'B', alpha: 0.05 },
        { grade: 'C', alpha: 0.1 },
      ],
    });

    it.each([0, 1])('등급 PUT 의 α = %p 는 400', async (alpha) => {
      await expect(
        pipe.transform(grades(alpha), { type: 'body', metatype: UpdateGradeRulesDto }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it.each([0, 1])('SKU 예외 PUT 의 α = %p 는 400', async (alpha) => {
      await expect(
        pipe.transform({ mode: 'auto', alpha }, { type: 'body', metatype: UpsertSkuOverrideDto }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('경계 안쪽 · null 은 통과한다', async () => {
      await expect(
        pipe.transform(grades(0.001), { type: 'body', metatype: UpdateGradeRulesDto }),
      ).resolves.toBeDefined();
      await expect(
        pipe.transform({ mode: 'auto', alpha: null }, { type: 'body', metatype: UpsertSkuOverrideDto }),
      ).resolves.toMatchObject({ mode: 'auto', alpha: null });
    });
  });
});
