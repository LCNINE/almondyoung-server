import { NextResponse } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import {
  resolveWorksiteAddress,
  resolveWorksiteCoordinates,
} from '@/features/attendance/lib/worksite-address';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getTokenPayload();

  if (
    !user ||
    !user.roles.some((role) => role === 'admin' || role === 'master')
  ) {
    return NextResponse.json(
      { message: '로그인이 필요해요.' },
      { status: 401 }
    );
  }

  let address: unknown;
  let latitude: unknown;
  let longitude: unknown;

  try {
    ({ address, latitude, longitude } = await request.json());
  } catch {
    return NextResponse.json(
      { message: '주소를 다시 선택해 주세요.' },
      { status: 400 }
    );
  }

  const validAddress =
    typeof address === 'string' && address.trim() && address.length <= 300;
  const validCoordinates =
    address === undefined &&
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;

  if (!validAddress && !validCoordinates) {
    return NextResponse.json(
      { message: '주소를 다시 선택해 주세요.' },
      { status: 400 }
    );
  }

  try {
    const apiKey = process.env.KAKAO_REST_API_KEY ?? '';
    const result = validCoordinates
      ? {
          address: await resolveWorksiteCoordinates(
            latitude as number,
            longitude as number,
            apiKey
          ),
        }
      : await resolveWorksiteAddress((address as string).trim(), apiKey);

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const knownMessages = [
      '주소 검색 연결 설정이 필요해요.',
      '주소 검색 연결을 확인하지 못했어요.',
      '선택한 주소의 위치를 확인하지 못했어요.',
      '현재 위치의 주소를 확인하지 못했어요.',
    ];

    return NextResponse.json(
      {
        message: knownMessages.includes(message)
          ? message
          : '주소의 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
      },
      { status: 503 }
    );
  }
}
