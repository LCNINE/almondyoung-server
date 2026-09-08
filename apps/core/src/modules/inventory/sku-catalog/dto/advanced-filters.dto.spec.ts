import { validate } from 'class-validator';
import { AdvancedInventoryFiltersDto, SKU_SORT_FIELDS } from './advanced-filters.dto';

/**
 * #743 B / Task 7 (R34): sortBy 는 sku-catalog.reader 가 `wmsTables.skus[sortField]` 로
 * 동적 접근하는 컬럼 키다. 예전엔 @IsString() 뿐이라 런타임 방어선이 0 이었다 — `safetyStock`
 * 을 sortBy 목록에서 지워도 클라이언트가 여전히 `sortBy=safetyStock` 을 보낼 수 있었고, 컬럼
 * drop 뒤엔 그게 500 이 됐을 것이다. @IsIn(SKU_SORT_FIELDS) 이 그 입력을 400 으로 막는다.
 */
describe('AdvancedInventoryFiltersDto.sortBy', () => {
  function dtoWith(sortBy: unknown): AdvancedInventoryFiltersDto {
    const dto = new AdvancedInventoryFiltersDto();
    // 잘못된 런타임 타입을 일부러 넣어 검증을 확인하는 테스트라 캐스팅이 필요하다
    dto.sortBy = sortBy as AdvancedInventoryFiltersDto['sortBy'];
    return dto;
  }

  it.each(SKU_SORT_FIELDS)('실제 지원 정렬 키 %s 를 받는다', async (field) => {
    await expect(validate(dtoWith(field))).resolves.toHaveLength(0);
  });

  it('sortBy 생략을 받는다', async () => {
    await expect(validate(new AdvancedInventoryFiltersDto())).resolves.toHaveLength(0);
  });

  it('컬럼 drop 대상이던 safetyStock 을 거부한다', async () => {
    const errors = await validate(dtoWith('safetyStock'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sortBy');
  });

  it('화이트리스트 밖의 임의 문자열을 거부한다(동적 컬럼 접근 방어)', async () => {
    const errors = await validate(dtoWith('id; DROP TABLE skus'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sortBy');
  });
});
