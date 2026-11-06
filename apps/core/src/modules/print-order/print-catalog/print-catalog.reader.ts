import { Injectable } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import { z } from 'zod';
import { WowpressClient } from '../wowpress/wowpress.client';
import { WowpressLineSpec, WowpressProdInfo } from '../wowpress/wowpress.types';
import { JobcostVerdict } from '../wowpress/wowpress-body';
import { PRINT_KIND_PRODUCTS, PrintKind, PrintKindProduct } from './print-kind-products';
import { buildPrintOptions, PrintOptionAxes } from './print-options.builder';

export interface PrintCombo {
  key: string;
  paperno: number;
  colorno: number;
  qty: number;
  awk: number[];
}

export interface PrintSize {
  width: number;
  height: number;
}

export type PrintOptionsView = PrintOptionAxes & { bleedMatches: boolean };

const sizeNamesSchema = z.array(
  z.object({ sizelist: z.array(z.object({ sizeno: z.number(), sizename: z.string().nullish() })) }),
);

const PROD_INFO_TTL_MS = 5 * 60 * 1000;

const sameSize = (size: PrintSize, w: number, h: number): boolean =>
  (size.width === w && size.height === h) || (size.width === h && size.height === w);

@Injectable()
export class PrintCatalogReader {
  private readonly prodInfoCache = new Map<number, { at: number; value: WowpressProdInfo }>();

  constructor(private readonly client: WowpressClient) {}

  async options(kind: PrintKind, size: PrintSize): Promise<PrintOptionsView> {
    const prodInfo = await this.cachedProdInfo(this.firstProdno(kind));
    const entry = this.selectProduct(kind, size, prodInfo);
    const axes = buildPrintOptions(prodInfo, entry);

    return { ...axes, bleedMatches: entry.bleedMm === axes.cutsizeHalfMm };
  }

  async quotes(
    kind: PrintKind,
    size: PrintSize,
    combos: PrintCombo[],
  ): Promise<{ key: string; verdict: JobcostVerdict }[]> {
    const prodInfo = await this.cachedProdInfo(this.firstProdno(kind));
    const results: { key: string; verdict: JobcostVerdict }[] = [];

    // 와우프레스 부하를 줄이려 조합을 순차로 부르고, 한 조합의 실패가 다른 조합을 막지 않게 한다
    for (const combo of combos) {
      results.push({ key: combo.key, verdict: await this.quoteOne(kind, size, combo, prodInfo) });
    }

    return results;
  }

  // 게시처럼 prodInfo 를 따로 들고 있지 않은 호출부용
  async specFor(kind: PrintKind, size: PrintSize, combo: PrintCombo): Promise<WowpressLineSpec> {
    const prodInfo = await this.cachedProdInfo(this.firstProdno(kind));

    return this.toSpec(kind, size, combo, prodInfo);
  }

  toSpec(kind: PrintKind, size: PrintSize, combo: PrintCombo, prodInfo: WowpressProdInfo): WowpressLineSpec {
    const entry = this.selectProduct(kind, size, prodInfo);
    const axes = buildPrintOptions(prodInfo, entry);
    const color = axes.colors.find((c) => c.colorno === combo.colorno);
    if (!color) throw new BadRequestError(`Unknown colorno for ${kind}: ${combo.colorno}`);

    const prsjob: Record<string, unknown> = {
      covercd: 0,
      sizeno: entry.sizeno,
      paperno: combo.paperno,
      colorno: combo.colorno,
      jobno: color.jobno,
    };
    if (entry.wsize !== undefined && entry.hsize !== undefined) {
      prsjob.wsize = entry.wsize;
      prsjob.hsize = entry.hsize;
    }

    return {
      prodno: entry.prodno,
      jobpresetno: String(color.jobno),
      prsjob: [prsjob],
      awkjob: combo.awk.map((jobno) => ({ covercd: 0, jobno })),
      qtyPerUnit: combo.qty,
      file: { format: entry.fileFormat, dpi: entry.fileDpi },
      design: { productId: '', widthMm: size.width, heightMm: size.height },
      confirmed: false,
    };
  }

  private async quoteOne(
    kind: PrintKind,
    size: PrintSize,
    combo: PrintCombo,
    prodInfo: WowpressProdInfo,
  ): Promise<JobcostVerdict> {
    try {
      return await this.client.jobcost(this.toSpec(kind, size, combo, prodInfo), 1);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  private firstProdno(kind: PrintKind): number {
    return PRINT_KIND_PRODUCTS[kind][0].prodno;
  }

  private selectProduct(kind: PrintKind, size: PrintSize, prodInfo: WowpressProdInfo): PrintKindProduct {
    const names = new Map(
      sizeNamesSchema
        .parse(prodInfo.sizeinfo ?? [])
        .flatMap((g) => g.sizelist)
        .map((s) => [s.sizeno, s.sizename ?? ''] as const),
    );

    const entry = PRINT_KIND_PRODUCTS[kind].find((p) => {
      if (p.wsize !== undefined && p.hsize !== undefined) return sameSize(size, p.wsize, p.hsize);

      const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(names.get(p.sizeno) ?? '');

      return match !== null && sameSize(size, Number(match[1]), Number(match[2]));
    });
    if (!entry) throw new BadRequestError(`Unsupported size for ${kind}: ${size.width}x${size.height}`);

    return entry;
  }

  private async cachedProdInfo(prodno: number): Promise<WowpressProdInfo> {
    const hit = this.prodInfoCache.get(prodno);
    if (hit && Date.now() - hit.at < PROD_INFO_TTL_MS) return hit.value;

    const value = await this.client.prodInfo(prodno);
    this.prodInfoCache.set(prodno, { at: Date.now(), value });

    return value;
  }
}
