import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  TransferJobListResponseDto,
  TransferJobWithLinesDto,
  TransferJobStatusDto,
  CreateTransferJobDto,
  CreateTransferJobResponseDto,
  ExecuteTransferJobResponseDto,
  MoveWithinWarehouseDto,
  MoveWithinWarehouseResponseDto,
  TransferJobQuery,
} from '../../../types/dto/inventory';

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const transfersClient = {
  listTransferJobs: async (
    query: TransferJobQuery = {}
  ): Promise<TransferJobListResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers?${buildQueryString(query as Record<string, unknown>)}`
    );
    return response.data;
  },

  getTransferJob: async (id: string): Promise<TransferJobWithLinesDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  getTransferJobStatus: async (id: string): Promise<TransferJobStatusDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}/status`
    );
    return response.data;
  },

  createTransferJob: async (
    data: CreateTransferJobDto
  ): Promise<CreateTransferJobResponseDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/inventory/transfers`, data);
    return response.data;
  },

  executeTransferJob: async (id: string): Promise<ExecuteTransferJobResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}/execute`
    );
    return response.data;
  },

  moveWithinWarehouse: async (
    data: MoveWithinWarehouseDto
  ): Promise<MoveWithinWarehouseResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/move-within-warehouse`,
      data
    );
    return response.data;
  },
};
