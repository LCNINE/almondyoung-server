import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ServiceUnavailableError } from '@app/shared';
import { ALMOND_PRINT_SIDE_GAP_MM, ALMOND_PRINT_TIMEOUT_MS } from '../constants/almond-template.constants';
import { composeSideBySide } from './almond-print-svg';

const execFileAsync = promisify(execFile);
const STDERR_MAX_BUFFER = 10 * 1024 * 1024;
const CMYK_ARGS = ['-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK'];

function isMissingBinary(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

@Injectable()
export class AlmondPrintRenderer {
  private readonly logger = new Logger(AlmondPrintRenderer.name);
  private readonly rsvgBin: string;
  private readonly gsBin: string;
  private readonly iccProfile: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(configService: ConfigService) {
    this.rsvgBin = configService.get<string>('RSVG_CONVERT_BIN') || 'rsvg-convert';
    this.gsBin = configService.get<string>('GHOSTSCRIPT_BIN') || 'gs';
    this.iccProfile = configService.get<string>('ALMOND_PRINT_ICC_PROFILE') || undefined;
  }

  renderEps(frontSvg: string, backSvg: string | null): Promise<Buffer> {
    return this.exclusive((dir) => this.convertEps(dir, frontSvg, backSvg));
  }

  renderPdf(frontSvg: string, backSvg: string | null): Promise<Buffer> {
    return this.exclusive((dir) => this.convertPdf(dir, frontSvg, backSvg));
  }

  private async convertEps(dir: string, frontSvg: string, backSvg: string | null): Promise<Buffer> {
    const svgPath = join(dir, 'sheet.svg');
    const pdfPath = join(dir, 'sheet.pdf');
    const epsPath = join(dir, 'print.eps');
    await writeFile(svgPath, composeSideBySide(frontSvg, backSvg, ALMOND_PRINT_SIDE_GAP_MM), 'utf8');
    await this.exec(this.rsvgBin, ['-f', 'pdf', '-o', pdfPath, svgPath]);
    await this.exec(this.gsBin, [...this.ghostscriptArgs('eps2write'), '-o', epsPath, pdfPath]);
    return readFile(epsPath);
  }

  private async convertPdf(dir: string, frontSvg: string, backSvg: string | null): Promise<Buffer> {
    const frontPath = join(dir, 'front.svg');
    const backPath = join(dir, 'back.svg');
    const pagesPath = join(dir, 'pages.pdf');
    const outPath = join(dir, 'print.pdf');
    await writeFile(frontPath, frontSvg, 'utf8');
    if (backSvg !== null) await writeFile(backPath, backSvg, 'utf8');
    const inputs = backSvg === null ? [frontPath] : [frontPath, backPath];
    await this.exec(this.rsvgBin, ['-f', 'pdf', '-o', pagesPath, ...inputs]);
    await this.exec(this.gsBin, [
      ...this.ghostscriptArgs('pdfwrite'),
      '-dPDFSETTINGS=/prepress',
      '-o',
      outPath,
      pagesPath,
    ]);
    return readFile(outPath);
  }

  private ghostscriptArgs(device: 'eps2write' | 'pdfwrite'): string[] {
    const icc = this.iccProfile
      ? [`--permit-file-read=${this.iccProfile}`, `-sOutputICCProfile=${this.iccProfile}`]
      : [];
    return ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNoOutputFonts', `-sDEVICE=${device}`, ...CMYK_ARGS, ...icc];
  }

  private exclusive<T>(task: (dir: string) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const dir = await mkdtemp(join(tmpdir(), 'almond-print-'));
      try {
        return await task(dir);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async exec(bin: string, args: string[]): Promise<void> {
    try {
      await execFileAsync(bin, args, { timeout: ALMOND_PRINT_TIMEOUT_MS, maxBuffer: STDERR_MAX_BUFFER });
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
