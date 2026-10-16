import { AttendanceService } from './attendance.service';

describe('AttendanceService punch', () => {
  const now = new Date('2026-10-16T04:00:00Z');
  let repo: any;
  let service: AttendanceService;
  const dto = {
    kind: 'in' as const,
    requestId: 'key',
    siteId: 'site',
    location: { latitude: 37.5, longitude: 127, accuracy: 10, timestamp: now.getTime() },
  };

  beforeEach(() => {
    repo = {
      withUserLock: jest.fn(async (_id, fn) => fn({})),
      findPunch: jest.fn().mockResolvedValue(null),
      findOpen: jest.fn().mockResolvedValue(null),
      findDay: jest.fn().mockResolvedValue(null),
      getSite: jest.fn().mockResolvedValue({
        id: 'site',
        name: '본사',
        latitude: 37.5,
        longitude: 127,
        radiusMeters: 150,
        accuracyMeters: 50,
        version: 1,
      }),
      createSession: jest
        .fn()
        .mockResolvedValue({ id: 'session', checkIn: now, checkOut: null, workDate: '2026-10-16', version: 1 }),
      finishSession: jest.fn().mockResolvedValue({
        id: 'session',
        checkIn: new Date('2026-10-15T14:00:00Z'),
        checkOut: now,
        workDate: '2026-10-15',
        userId: 'user',
        version: 2,
      }),
      appendPunch: jest.fn(),
    };

    service = new AttendanceService(repo);
  });

  it('records only after location succeeds', async () => {
    await service.punch('user', dto, now);

    expect(repo.createSession).toHaveBeenCalledTimes(1);

    expect(repo.appendPunch).toHaveBeenCalledTimes(1);
  });

  it('does not write if location cannot verify the workplace', async () => {
    await expect(service.punch('user', { ...dto, location: { ...dto.location, latitude: 38 } }, now)).rejects.toThrow();

    expect(repo.createSession).not.toHaveBeenCalled();

    expect(repo.appendPunch).not.toHaveBeenCalled();
  });

  it('replays the stored result for the same request', async () => {
    repo.findPunch.mockResolvedValue({ kind: 'in', result: { id: 'original' } });

    expect(await service.punch('user', dto, now)).toEqual({ id: 'original' });

    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it('rejects request identifiers reused for a different operation', async () => {
    repo.findPunch.mockResolvedValue({ kind: 'out', result: {} });

    await expect(service.punch('user', dto, now)).rejects.toThrow();
  });

  it('prevents a second pair on the same work date', async () => {
    repo.findDay.mockResolvedValue({ id: 'completed', checkOut: now });

    await expect(service.punch('user', dto, now)).rejects.toThrow();
  });

  it('closes the original open session after midnight', async () => {
    repo.findOpen.mockResolvedValue({
      id: 'yesterday',
      workDate: '2026-10-15',
      checkIn: new Date('2026-10-15T14:00:00Z'),
    });

    await service.punch('user', { ...dto, kind: 'out' }, now);

    expect(repo.finishSession).toHaveBeenCalledWith(expect.anything(), 'yesterday', now);

    expect(repo.createSession).not.toHaveBeenCalled();
  });
});
