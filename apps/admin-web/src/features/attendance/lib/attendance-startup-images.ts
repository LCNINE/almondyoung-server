import {
  ATTENDANCE_CLOCK_ART,
  ATTENDANCE_SPLASH_TITLE,
  ATTENDANCE_SPLASH_TITLE_WIDTH,
} from './attendance-clock-art';

// Logical screen sizes and scale factors, including display zoom and iPads.
const screens = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 2],
  [414, 896, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
  [420, 912, 3],
  [768, 1024, 2],
  [810, 1080, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [834, 1194, 2],
  [836, 1210, 2],
  [1024, 1366, 2],
  [1032, 1376, 2],
] as const;

export const attendanceStartupImages = screens.flatMap(
  ([width, height, scale]) =>
    (['portrait', 'landscape'] as const).map((orientation) => {
      const landscape = orientation === 'landscape';
      const imageWidth = landscape ? height : width;
      const imageHeight = landscape ? width : height;

      return {
        url: `/api/attendance/startup-image?width=${imageWidth}&height=${imageHeight}&scale=${scale}&v=clock-1`,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation})`,
      };
    })
);

export async function renderAttendanceStartupImage(
  width: number,
  height: number,
  scale: number
) {
  const supported = screens.some(
    ([screenWidth, screenHeight, screenScale]) =>
      screenScale === scale &&
      ((screenWidth === width && screenHeight === height) ||
        (screenWidth === height && screenHeight === width))
  );

  if (!supported) {
    throw new Error('Unsupported startup image');
  }

  // Match the responsive web splash, including its centered scene and title.
  const sceneWidth = Math.min(width * 0.74, height * 0.3, 280);
  const sceneHeight = (sceneWidth * 380) / 360;
  const top = height * 0.45 - (sceneHeight + 24 + 26) / 2;
  const titleX = (width - ATTENDANCE_SPLASH_TITLE_WIDTH) / 2;
  const titleY = top + sceneHeight + 24 + 20;
  const art = ATTENDANCE_CLOCK_ART.replaceAll('__CLOCK_ID__', 'native-clock');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#FFFBF5"/>
      <svg x="${(width - sceneWidth) / 2}" y="${top}" width="${sceneWidth}" height="${sceneHeight}" viewBox="0 0 360 380" overflow="hidden">
        ${art}
      </svg>
      <g transform="translate(${titleX} ${titleY})" fill="#443D37">
        ${ATTENDANCE_SPLASH_TITLE}
      </g>
    </svg>
  `;

  // ponytail: OpenNext 가 Lambda 번들에서 sharp 를 빼므로, 최상단 import 면 이 파일을 쓰는 /attendance 전체가 500 이 된다
  const { default: sharp } = await import('sharp');
  return sharp(Buffer.from(svg)).png().toBuffer();
}
