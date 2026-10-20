import { renderAttendanceStartupImage } from '@/features/attendance/lib/attendance-startup-images';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const width = Number(params.get('width'));
  const height = Number(params.get('height'));
  const scale = Number(params.get('scale'));

  try {
    const image = await renderAttendanceStartupImage(width, height, scale);

    return new Response(new Uint8Array(image), {
      headers: {
        'Content-Type': 'image/png',
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
