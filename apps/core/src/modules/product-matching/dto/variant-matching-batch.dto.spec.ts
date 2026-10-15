import { ArgumentMetadata } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { UpdateVariantStockPolicyDto } from './variant-matching-batch.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdateVariantStockPolicyDto,
};

describe('UpdateVariantStockPolicyDto', () => {
  const pipe = createGlobalValidationPipe();

  // whitelist: true 라 DTO 에 없는 필드는 조용히 사라진다. comingSoonDate 선언이 빠져 있던
  // 동안 어드민이 보낸 출시일이 매번 null 로 떨어졌고, 화면에서만 저장된 것처럼 보였다.
  it('출시일을 살려서 통과시킨다', async () => {
    const result = await pipe.transform(
      { availabilityOverride: 'coming_soon', comingSoonDate: '2026-08-10' },
      metadata,
    );

    expect(result).toMatchObject({
      availabilityOverride: 'coming_soon',
      comingSoonDate: '2026-08-10',
    });
  });

  it('출시일 없이도 통과한다 — 날짜는 선택값이다', async () => {
    const result = await pipe.transform({ availabilityOverride: 'coming_soon' }, metadata);

    expect(result).toEqual({ availabilityOverride: 'coming_soon' });
  });

  it('날짜 형식이 아니면 거부한다', async () => {
    await expect(
      pipe.transform({ availabilityOverride: 'coming_soon', comingSoonDate: '곧' }, metadata),
    ).rejects.toThrow();
  });

  it('재입고 날짜와 대략적인 일정 여부를 whitelist 이후에도 보존한다', async () => {
    expect(await pipe.transform({ restockDate: '2026-10-17', restockApproximate: true }, metadata)).toEqual({
      restockDate: '2026-10-17',
      restockApproximate: true,
    });
    expect(await pipe.transform({ restockDate: null, restockApproximate: false }, metadata)).toEqual({
      restockDate: null,
      restockApproximate: false,
    });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-10-17T00:00:00Z', '곧'])(
    '유효한 달력 날짜가 아니면 거절한다: %s',
    async (restockDate) => {
      await expect(pipe.transform({ restockDate }, metadata)).rejects.toThrow();
    },
  );
});
