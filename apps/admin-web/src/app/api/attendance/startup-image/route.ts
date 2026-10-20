import { ImageResponse } from 'next/og';
import { createElement } from 'react';
import { renderAttendanceStartupSvg } from '@/features/attendance/lib/attendance-startup-images';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const width = Number(params.get('width'));
  const height = Number(params.get('height'));
  const scale = Number(params.get('scale'));

  try {
    const svg = renderAttendanceStartupSvg(width, height, scale);
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const size = { width: width * scale, height: height * scale };

    // OpenNext 가 Lambda 서버 번들에서 sharp 를 빼므로 next/og(resvg wasm)로 PNG 를 만든다
    return new ImageResponse(createElement('img', { src, ...size }), {
      ...size,
      headers: {
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Unsupported startup image'
    ) {
      return new Response('Unsupported startup image', { status: 400 });
    }

    throw error;
  }
}
