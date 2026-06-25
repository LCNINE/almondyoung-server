import { validate } from 'class-validator';
import { AssignCsCaseDto } from './assign-cs-case.dto';

describe('AssignCsCaseDto', () => {
  it('accepts a UUID assigneeId', async () => {
    const dto = new AssignCsCaseDto();
    dto.assigneeId = '550e8400-e29b-41d4-a716-446655440000';

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts an explicit null assigneeId', async () => {
    const dto = new AssignCsCaseDto();
    dto.assigneeId = null;

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an omitted assigneeId', async () => {
    const dto = new AssignCsCaseDto();

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('assigneeId');
  });
});
