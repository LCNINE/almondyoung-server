import { plainToInstance } from 'class-transformer';
import { TemplateFilterDto } from './template-filter.dto';

describe('TemplateFilterDto', () => {
  it('isActive 를 안 보내면 필터하지 않는다', () => {
    expect(plainToInstance(TemplateFilterDto, {}).isActive).toBeUndefined();
  });

  it('쿼리 문자열 true/false 를 불리언으로 바꾼다', () => {
    expect(plainToInstance(TemplateFilterDto, { isActive: 'true' }).isActive).toBe(true);
    expect(plainToInstance(TemplateFilterDto, { isActive: 'false' }).isActive).toBe(false);
  });
});
