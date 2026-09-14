import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createGlobalValidationPipe } from './validation-pipe';

class LegacyQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number;

  @IsString()
  name: string;
}

class ZodQueryDto extends createZodDto(
  z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      name: z.string().trim().min(1),
    })
    .strict(),
) {}

describe('Core 전역 혼합 DTO 검증', () => {
  const pipe = createGlobalValidationPipe();

  it('기존 클래스 DTO의 변환/whitelist 동작을 유지한다', async () => {
    const result = await pipe.transform(
      { page: '2', name: '상품', forgedOwnerId: 'other' },
      {
        type: 'query',
        metatype: LegacyQueryDto,
      },
    );
    expect(result).toBeInstanceOf(LegacyQueryDto);
    expect(result).toEqual({ page: 2, name: '상품' });
  });

  it('기존 클래스의 잘못된 입력을 계속 거절한다', async () => {
    await expect(
      pipe.transform({ page: '0', name: '상품' }, { type: 'query', metatype: LegacyQueryDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Zod DTO 필드를 whitelist로 지우지 않고 스키마의 변환/기본값을 적용한다', async () => {
    await expect(pipe.transform({ name: ' 상품 ' }, { type: 'query', metatype: ZodQueryDto })).resolves.toEqual({
      page: 1,
      name: '상품',
    });
  });

  it('Zod의 strict 검증은 미지정 필드를 제거하는 대신 거절한다', async () => {
    await expect(
      pipe.transform({ name: '상품', forgedOwnerId: 'other' }, { type: 'body', metatype: ZodQueryDto }),
    ).rejects.toThrow(BadRequestException);
  });

  it('원시 파라미터와 인증용 custom 파라미터는 기존 처리에 맡긴다', async () => {
    await expect(pipe.transform('2', { type: 'param', metatype: Number, data: 'id' })).resolves.toBe(2);
    const user = { userId: 'authenticated-user', roles: ['admin'] };
    await expect(pipe.transform(user, { type: 'custom', metatype: Object })).resolves.toBe(user);
  });
});
