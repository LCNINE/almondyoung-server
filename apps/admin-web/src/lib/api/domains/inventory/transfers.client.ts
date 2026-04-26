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

export const listTransferJobs = async (
  query: TransferJobQuery = {}
): Promise<TransferJobListResponseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers?${buildQueryString(query as Record<string, unknown>)}`
  );
  return response.data;
};

export const getTransferJob = async (id: string): Promise<TransferJobWithLinesDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}`
  );
  return response.data;
};

export const getTransferJobStatus = async (id: string): Promise<TransferJobStatusDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}/status`
  );
  return response.data;
};

export const createTransferJob = async (
  data: CreateTransferJobDto
): Promise<CreateTransferJobResponseDto> => {
  const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/inventory/transfers`, data);
  return response.data;
};

export const executeTransferJob = async (id: string): Promise<ExecuteTransferJobResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/${encodeURIComponent(id)}/execute`
  );
  return response.data;
};

export const moveWithinWarehouse = async (
  data: MoveWithinWarehouseDto
): Promise<MoveWithinWarehouseResponseDto> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/transfers/move-within-warehouse`,
    data
  );
  return response.data;
};

export const transfersClient = {
  listTransferJobs,
  getTransferJob,
  getTransferJobStatus,
  createTransferJob,
  executeTransferJob,
  moveWithinWarehouse,
};
