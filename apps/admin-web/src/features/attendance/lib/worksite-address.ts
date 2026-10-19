export async function resolveWorksiteAddress(address: string, apiKey: string) {
  if (!apiKey) {
    throw new Error('주소 검색 연결 설정이 필요해요.');
  }

  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json');

  url.searchParams.set('query', address);
  url.searchParams.set('size', '1');

  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error('주소 검색 연결을 확인하지 못했어요.');
  }

  const result = await response.json();
  const point = result.documents?.[0];
  const latitude = Number(point?.y);
  const longitude = Number(point?.x);

  if (
    !point?.x ||
    !point?.y ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('선택한 주소의 위치를 확인하지 못했어요.');
  }

  return { latitude, longitude };
}

export async function resolveWorksiteCoordinates(
  latitude: number,
  longitude: number,
  apiKey: string
) {
  if (!apiKey) {
    throw new Error('주소 검색 연결 설정이 필요해요.');
  }

  const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2address.json');

  url.searchParams.set('x', String(longitude));
  url.searchParams.set('y', String(latitude));
  url.searchParams.set('input_coord', 'WGS84');

  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error('주소 검색 연결을 확인하지 못했어요.');
  }

  const result = await response.json();
  const location = result.documents?.[0];
  const address =
    location?.road_address?.address_name || location?.address?.address_name;

  if (typeof address !== 'string' || !address.trim() || address.length > 300) {
    throw new Error('현재 위치의 주소를 확인하지 못했어요.');
  }

  return address.trim();
}
