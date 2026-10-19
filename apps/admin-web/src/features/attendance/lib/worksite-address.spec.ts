import {
  resolveWorksiteAddress,
  resolveWorksiteCoordinates,
} from './worksite-address';

describe('worksite address coordinates', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires server configuration instead of inventing coordinates', async () => {
    await expect(
      resolveWorksiteAddress('서울 중구 세종대로 110', '')
    ).rejects.toThrow('주소 검색 연결 설정이 필요해요.');
  });

  it('converts a selected address into latitude and longitude', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [{ x: '126.9784', y: '37.5666' }] }),
    } as Response);

    await expect(
      resolveWorksiteAddress('서울 중구 세종대로 110', 'test-key')
    ).resolves.toEqual({ latitude: 37.5666, longitude: 126.9784 });
  });

  it.each([
    { documents: [] },
    { documents: [{ x: '', y: '' }] },
    { documents: [{ x: '200', y: '37' }] },
  ])('rejects missing or invalid coordinates: %j', async (response) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response);

    await expect(
      resolveWorksiteAddress('서울 중구 세종대로 110', 'test-key')
    ).rejects.toThrow('선택한 주소의 위치를 확인하지 못했어요.');
  });

  it('reports provider failure without accepting a location', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(
      resolveWorksiteAddress('서울 중구 세종대로 110', 'test-key')
    ).rejects.toThrow('주소 검색 연결을 확인하지 못했어요.');
  });
});

describe('current worksite location address', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fills a road address for the captured coordinates', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [
          {
            road_address: { address_name: '서울 중구 세종대로 110' },
            address: { address_name: '서울 중구 태평로1가 31' },
          },
        ],
      }),
    } as Response);

    await expect(
      resolveWorksiteCoordinates(37.5666, 126.9784, 'test-key')
    ).resolves.toBe('서울 중구 세종대로 110');
  });

  it('uses a lot address when no road address exists', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [
          {
            road_address: null,
            address: { address_name: '서울 중구 태평로1가 31' },
          },
        ],
      }),
    } as Response);

    await expect(
      resolveWorksiteCoordinates(37.5666, 126.9784, 'test-key')
    ).resolves.toBe('서울 중구 태평로1가 31');
  });

  it('does not invent an address when configuration is missing', async () => {
    await expect(
      resolveWorksiteCoordinates(37.5666, 126.9784, '')
    ).rejects.toThrow('주소 검색 연결 설정이 필요해요.');
  });

  it('reports a location with no address', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [] }),
    } as Response);

    await expect(
      resolveWorksiteCoordinates(37.5666, 126.9784, 'test-key')
    ).rejects.toThrow('현재 위치의 주소를 확인하지 못했어요.');
  });
});
