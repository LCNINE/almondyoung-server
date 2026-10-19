import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ServiceUnavailableError } from '@app/shared';
import {
  ALMOND_PREVIEW_LONG_SIDE_PX,
  ALMOND_PRINT_SIDE_GAP_MM,
  ALMOND_PRINT_TIMEOUT_MS,
} from '../constants/almond-template.constants';
import { type AlmondFontFormat, almondFontsConfig } from './almond-print-fonts';
import { composeSideBySide, readSvgSizeMm } from './almond-print-svg';

export interface AlmondPrintFont {
  family: string;
  bytes: Buffer;
  format: AlmondFontFormat;
}

type Exec = (bin: string, args: string[]) => Promise<void>;

const UNPACK_FONT =
  'import sys\nfrom fontTools.ttLib import TTFont\nf = TTFont(sys.argv[1])\nf.flavor = None\nf.save(sys.argv[2])';

const execFileAsync = promisify(execFile);
const STDERR_MAX_BUFFER = 10 * 1024 * 1024;
const CMYK_ARGS = ['-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK'];

export function withJpegDensity(jpeg: Buffer, dpi: number): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write('JFIF\0', 4, 'latin1');
  app0.writeUInt16BE(0x0102, 9);
  app0.writeUInt8(1, 11);
  app0.writeUInt16BE(dpi, 12);
  app0.writeUInt16BE(dpi, 14);
  const rest = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? jpeg.subarray(4 + jpeg.readUInt16BE(4)) : jpeg.subarray(2);
  return Buffer.concat([jpeg.subarray(0, 2), app0, rest]);
}

function isMissingBinary(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

@Injectable()
export class AlmondPrintRenderer {
  private readonly logger = new Logger(AlmondPrintRenderer.name);
  private readonly rsvgBin: string;
  private readonly gsBin: string;
  private readonly pythonBin: string;
  private readonly iccProfile: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(configService: ConfigService) {
    this.rsvgBin = configService.get<string>('RSVG_CONVERT_BIN') || 'rsvg-convert';
    this.gsBin = configService.get<string>('GHOSTSCRIPT_BIN') || 'gs';
    this.pythonBin = configService.get<string>('FONTTOOLS_PYTHON_BIN') || 'python3';
    this.iccProfile = configService.get<string>('ALMOND_PRINT_ICC_PROFILE') || undefined;
  }

  renderEps(frontSvg: string, backSvg: string | null, fonts: readonly AlmondPrintFont[] = []): Promise<Buffer> {
    return this.exclusive(fonts, (dir, exec) => this.convertEps(dir, exec, frontSvg, backSvg));
  }

  renderPdf(frontSvg: string, backSvg: string | null, fonts: readonly AlmondPrintFont[] = []): Promise<Buffer> {
    return this.exclusive(fonts, (dir, exec) => this.convertPdf(dir, exec, frontSvg, backSvg));
  }

  renderJpg(
    frontSvg: string,
    backSvg: string | null,
    dpi: number,
    fonts: readonly AlmondPrintFont[] = [],
  ): Promise<Buffer> {
    return this.exclusive(fonts, (dir, exec) => this.convertJpg(dir, exec, frontSvg, backSvg, dpi));
  }

  renderPreview(svg: string, fonts: readonly AlmondPrintFont[] = []): Promise<Buffer> {
    return this.exclusive(fonts, (dir, exec) => this.convertPreview(dir, exec, svg));
  }

  private async convertPreview(dir: string, exec: Exec, svg: string): Promise<Buffer> {
    const size = readSvgSizeMm(svg);
    if (!size) throw new Error('SVG 루트 크기를 읽을 수 없습니다');
    const dpi = Math.max(1, Math.floor((ALMOND_PREVIEW_LONG_SIDE_PX * 25.4) / Math.max(size.width, size.height)));
    const svgPath = join(dir, 'preview.svg');
    const pdfPath = join(dir, 'preview.pdf');
    const jpgPath = join(dir, 'preview.jpg');
    await writeFile(svgPath, svg, 'utf8');
    await exec(this.rsvgBin, ['-f', 'pdf', '-o', pdfPath, svgPath]);
    await exec(this.gsBin, [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=jpeg',
      `-r${dpi}`,
      '-dJPEGQ=85',
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      '-o',
      jpgPath,
      pdfPath,
    ]);
    return readFile(jpgPath);
  }

  private async convertJpg(
    dir: string,
    exec: Exec,
    frontSvg: string,
    backSvg: string | null,
    dpi: number,
  ): Promise<Buffer> {
    const svgPath = join(dir, 'sheet.svg');
    const pdfPath = join(dir, 'sheet.pdf');
    const jpgPath = join(dir, 'print.jpg');
    await writeFile(svgPath, composeSideBySide(frontSvg, backSvg, ALMOND_PRINT_SIDE_GAP_MM), 'utf8');
    await exec(this.rsvgBin, ['-f', 'pdf', '-o', pdfPath, svgPath]);
    await exec(this.gsBin, [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-sDEVICE=jpegcmyk',
      `-r${dpi}`,
      '-dJPEGQ=95',
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      ...this.iccArgs(),
      '-o',
      jpgPath,
      pdfPath,
    ]);
    return withJpegDensity(await readFile(jpgPath), dpi);
  }

  private async convertEps(dir: string, exec: Exec, frontSvg: string, backSvg: string | null): Promise<Buffer> {
    const svgPath = join(dir, 'sheet.svg');
    const pdfPath = join(dir, 'sheet.pdf');
    const epsPath = join(dir, 'print.eps');
    await writeFile(svgPath, composeSideBySide(frontSvg, backSvg, ALMOND_PRINT_SIDE_GAP_MM), 'utf8');
    await exec(this.rsvgBin, ['-f', 'pdf', '-o', pdfPath, svgPath]);
    await exec(this.gsBin, [...this.ghostscriptArgs('eps2write'), '-o', epsPath, pdfPath]);
    return readFile(epsPath);
  }

  private async convertPdf(dir: string, exec: Exec, frontSvg: string, backSvg: string | null): Promise<Buffer> {
    const frontPath = join(dir, 'front.svg');
    const backPath = join(dir, 'back.svg');
    const pagesPath = join(dir, 'pages.pdf');
    const outPath = join(dir, 'print.pdf');
    await writeFile(frontPath, frontSvg, 'utf8');
    if (backSvg !== null) await writeFile(backPath, backSvg, 'utf8');
    const inputs = backSvg === null ? [frontPath] : [frontPath, backPath];
    await exec(this.rsvgBin, ['-f', 'pdf', '-o', pagesPath, ...inputs]);
    await exec(this.gsBin, [...this.ghostscriptArgs('pdfwrite'), '-dPDFSETTINGS=/prepress', '-o', outPath, pagesPath]);
    return readFile(outPath);
  }

  private ghostscriptArgs(device: 'eps2write' | 'pdfwrite'): string[] {
    return [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dNoOutputFonts',
      `-sDEVICE=${device}`,
      ...CMYK_ARGS,
      ...this.iccArgs(),
    ];
  }

  private iccArgs(): string[] {
    return this.iccProfile ? [`--permit-file-read=${this.iccProfile}`, `-sOutputICCProfile=${this.iccProfile}`] : [];
  }

  private exclusive<T>(fonts: readonly AlmondPrintFont[], task: (dir: string, exec: Exec) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const dir = await mkdtemp(join(tmpdir(), 'almond-print-'));
      try {
        const env = await this.prepareFonts(dir, fonts);
        return await task(dir, (bin, args) => this.exec(bin, args, env));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  // rsvg-convert 는 SVG 안 웹폰트를 읽지 않으므로, 업로드 글꼴은 이번 변환에서만 fontconfig 에 얹는다
  private async prepareFonts(dir: string, fonts: readonly AlmondPrintFont[]): Promise<NodeJS.ProcessEnv | undefined> {
    if (!fonts.length) return undefined;
    const fontDir = join(dir, 'fonts');
    await mkdir(fontDir);
    const files = new Map<string, string>();
    for (const font of fonts) {
      const path = join(fontDir, `${font.family}.ttf`);
      if (font.format === 'ttf' || font.format === 'otf') {
        await writeFile(path, font.bytes);
      } else {
        // pango 가 WOFF·WOFF2 를 읽지 못해 대체 글꼴로 조용히 바뀌므로 풀어서 넣는다
        const packed = join(dir, `${font.family}.${font.format}`);
        await writeFile(packed, font.bytes);
        await this.exec(this.pythonBin, ['-c', UNPACK_FONT, packed, path]);
      }
      files.set(font.family, path);
    }
    const configPath = join(dir, 'fonts.conf');
    await writeFile(configPath, almondFontsConfig(fontDir, join(dir, 'fontcache'), files), 'utf8');
    return { ...process.env, FONTCONFIG_FILE: configPath };
  }

  private async exec(bin: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
    try {
      await execFileAsync(bin, args, { timeout: ALMOND_PRINT_TIMEOUT_MS, maxBuffer: STDERR_MAX_BUFFER, env });
    } catch (error: unknown) {
      if (isMissingBinary(error)) {
        throw new ServiceUnavailableError(`인쇄 파일 변환기(${bin})가 설치되어 있지 않습니다.`);
      }
      const stderr =
        typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr).slice(0, 2000) : '';
      this.logger.error(`${bin} 실패: ${String(error)} ${stderr}`);
      throw new Error(`인쇄 파일 변환에 실패했습니다 (${bin})`);
    }
  }
}
