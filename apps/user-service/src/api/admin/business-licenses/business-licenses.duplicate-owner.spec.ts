import { BusinessLicensesService } from './business-licenses.service';

const verifiedAt = new Date('2026-11-01T00:00:00Z');

function licenseRow(metadata: unknown) {
  return {
    id: 'license-1',
    userId: 'user-1',
    userName: '신청자',
    tenantId: 'tenant-a',
    businessNumber: null,
    status: 'under_review',
    metadata,
  };
}

function duplicateMetadata(reason: string, businessNumber: string | null = '3822900179') {
  return {
    autoReview: {
      decision: 'manual',
      reason,
      dryRun: false,
      model: 'test-model',
      reviewedAt: '2026-11-20T00:00:00Z',
      reading: {
        isBusinessRegistration: true,
        businessNumber,
        representativeName: '전성구',
        startDate: '19941024',
        isCorporation: false,
        readable: true,
      },
    },
  };
}

function makeService(row: unknown, owners: unknown[] = []) {
  const limit = jest.fn().mockResolvedValue(owners);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const where = jest.fn().mockReturnValueOnce(Promise.resolve([row])).mockReturnValue({ orderBy });
  const select = jest.fn().mockReturnValue({ from: () => ({ leftJoin: () => ({ where }) }) });

  const service = new BusinessLicensesService(
    { db: { select } } as never,
    { publishEvent: jest.fn() } as never,
    {} as never,
    'tenant-a',
  );

  return { service, select, limit };
}

describe('사업자 인증 상세의 같은 번호 계정', () => {
  it('자동 심사 사유가 중복 번호가 아니면 찾지 않는다', async () => {
    const { service, select } = makeService(licenseRow(duplicateMetadata('name_mismatch')));

    const result = await service.getBusinessLicenseDetail('license-1');

    expect(result?.duplicateOf).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('판독한 번호가 없으면 찾지 않는다', async () => {
    const { service, select } = makeService(licenseRow(duplicateMetadata('duplicate_number', null)));

    const result = await service.getBusinessLicenseDetail('license-1');

    expect(result?.duplicateOf).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('자동 심사 기록이 없으면 찾지 않는다', async () => {
    const { service, select } = makeService(licenseRow(null));

    const result = await service.getBusinessLicenseDetail('license-1');

    expect(result?.duplicateOf).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('중복 번호면 그 번호를 가진 계정을 싣는다', async () => {
    const owner = { userId: 'user-2', userName: '기존회원', email: 'owner@example.com', verifiedAt };
    const { service, select, limit } = makeService(licenseRow(duplicateMetadata('duplicate_number')), [owner]);

    const result = await service.getBusinessLicenseDetail('license-1');

    expect(select).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(1);
    expect(result?.duplicateOf).toEqual(owner);
    expect(result?.id).toBe('license-1');
  });

  it('중복 번호인데 다른 계정이 없으면 null 이다', async () => {
    const { service } = makeService(licenseRow(duplicateMetadata('duplicate_number')), []);

    const result = await service.getBusinessLicenseDetail('license-1');

    expect(result?.duplicateOf).toBeNull();
  });

  it('행이 없으면 그대로 비어 있다', async () => {
    const { service, select } = makeService(undefined);

    const result = await service.getBusinessLicenseDetail('missing');

    expect(result).toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
  });
});
