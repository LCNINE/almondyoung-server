/** Temporary development-only probe for the installed iPhone launch path. */
export async function reportInstalledStartup() {
  const links = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel="apple-touch-startup-image"]'
    )
  );
  const matches = links.filter((link) => window.matchMedia(link.media).matches);
  const report: Record<string, number | boolean | string> = {
    screenWidth: screen.width,
    screenHeight: screen.height,
    pixelRatio: devicePixelRatio,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    installed: true,
    matches: matches.length,
    headLinks: links.length,
    headMatches: matches.length,
    iosVersion:
      (navigator.userAgent.match(/OS ([0-9_]+)/) || [])[1] || 'unknown',
  };

  try {
    if (matches.length === 1) {
      const image = new Image();
      image.src = matches[0].href;

      await image.decode();

      report.imageWidth = image.naturalWidth;
      report.imageHeight = image.naturalHeight;
      report.imageLoaded = true;
    }
  } catch {
    report.imageLoaded = false;
  }

  await fetch('/api/attendance/startup-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined);
}
