import { attendanceStartupImages } from '@/features/attendance/lib/attendance-startup-images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not found', { status: 404 });
  }

  const images = JSON.stringify(attendanceStartupImages).replaceAll(
    '<',
    '\\u003c'
  );
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>시작 화면 진단</title>
  <style>
    body { margin: 0; padding: 28px 20px; background: #fffbf5; color: #443d37; font: 16px/1.6 system-ui; }
    h1 { font-size: 22px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.7 system-ui; }
    img { display: block; width: min(100%, 220px); height: auto; margin: 20px auto; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>시작 화면 진단</h1>
  <p id="status">기기 조건과 시작 이미지를 확인하고 있어요.</p>
  <pre id="report"></pre>
  <script>
    (async function () {
      const entries = ${images};
      const matches = entries.filter(entry => matchMedia(entry.media).matches);
      const report = {
        screenWidth: screen.width,
        screenHeight: screen.height,
        pixelRatio: devicePixelRatio,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        installed: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
        matches: matches.length,
        iosVersion: (navigator.userAgent.match(/OS ([0-9_]+)/) || [])[1] || 'unknown',
      };

      try {
        const page = await fetch('/attendance', { cache: 'no-store' });
        const document = new DOMParser().parseFromString(await page.text(), 'text/html');
        const links = Array.from(document.head.querySelectorAll('link[rel="apple-touch-startup-image"]'));
        report.headLinks = links.length;
        report.headMatches = links.filter(link => matchMedia(link.media).matches).length;
        report.redirected = page.redirected;

        if (matches.length === 1) {
          const image = new Image();
          image.src = matches[0].url;
          await image.decode();
          report.imageWidth = image.naturalWidth;
          report.imageHeight = image.naturalHeight;
          report.imageLoaded = true;
          window.document.body.append(image);
        }
      } catch (error) {
        report.error = error instanceof Error ? error.message : 'Image check failed';
      }

      window.document.getElementById('status').textContent = '검사가 끝났어요. 결과를 개발 서버로 보냈습니다.';
      window.document.getElementById('report').textContent = JSON.stringify(report, null, 2);

      await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not found', { status: 404 });
  }

  const input = await request.json().catch(() => null);

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return new Response('Invalid diagnostic', { status: 400 });
  }

  const report: Record<string, number | boolean | string> = {};
  const numberFields = [
    'screenWidth',
    'screenHeight',
    'pixelRatio',
    'viewportWidth',
    'viewportHeight',
    'matches',
    'headLinks',
    'headMatches',
    'imageWidth',
    'imageHeight',
  ];

  for (const field of numberFields) {
    if (typeof input[field] === 'number' && Number.isFinite(input[field])) {
      report[field] = input[field];
    }
  }

  for (const field of ['installed', 'imageLoaded', 'redirected']) {
    if (typeof input[field] === 'boolean') {
      report[field] = input[field];
    }
  }

  if (
    typeof input.iosVersion === 'string' &&
    /^[0-9_]{1,20}$/.test(input.iosVersion)
  ) {
    report.iosVersion = input.iosVersion;
  }

  console.info('[attendance-startup-check]', JSON.stringify(report));

  return Response.json(
    { received: true },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
