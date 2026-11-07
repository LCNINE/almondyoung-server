'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  PrintKind,
  PrintOptionsDto,
  PrintQuoteDto,
  PrintQuotesBodyDto,
  PublishPrintProductDto,
  PublishPrintProductResultDto,
} from '../../../types/dto/print-catalog';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/admin/print-catalog`;

export const printCatalogClient = {
  options: async (kind: PrintKind, width: number, height: number): Promise<PrintOptionsDto> => {
    const response = await client.get(`${BASE}/${kind}/options`, { params: { width, height } });
    return response.data;
  },

  quotes: async (kind: PrintKind, body: PrintQuotesBodyDto): Promise<PrintQuoteDto[]> => {
    const response = await client.post(`${BASE}/${kind}/quotes`, body, { timeout: 120000 });
    return response.data;
  },

  publish: async (body: PublishPrintProductDto): Promise<PublishPrintProductResultDto> => {
    const response = await client.post(`${BASE}/publish`, body, { timeout: 120000 });
    return response.data;
  },
};
