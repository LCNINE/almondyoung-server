import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ReturnListResponseDto,
  ReturnDto,
  ReturnFiltersDto,
  CreateReturnDto,
  CreateReturnResponseDto,
  ReceiveReturnDto,
  ReceiveReturnResponseDto,
  InspectReturnDto,
  InspectReturnResponseDto,
  ProcessReturnDto,
  ProcessReturnResponseDto,
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

export const listReturns = async (filters: ReturnFiltersDto = {}): Promise<ReturnListResponseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/returns?${buildQueryString(filters as Record<string, unknown>)}`
  );
  return response.data;
};

export const getReturn = async (id: string): Promise<ReturnDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/returns/${encodeURIComponent(id)}`
  );
  return response.data;
};

export const createReturn = async (data: CreateReturnDto): Promise<CreateReturnResponseDto> => {
  const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/inventory/returns`, data);
  return response.data;
};

export const receiveReturn = async (
  id: string,
  data: ReceiveReturnDto
): Promise<ReceiveReturnResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/returns/${encodeURIComponent(id)}/receive`,
    data
  );
  return response.data;
};

export const inspectReturn = async (
  id: string,
  data: InspectReturnDto
): Promise<InspectReturnResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/returns/${encodeURIComponent(id)}/inspect`,
    data
  );
  return response.data;
};

export const processReturn = async (
  id: string,
  data: ProcessReturnDto
): Promise<ProcessReturnResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/inventory/returns/${encodeURIComponent(id)}/process`,
    data
  );
  return response.data;
};

export const returnsClient = {
  listReturns,
  getReturn,
  createReturn,
  receiveReturn,
  inspectReturn,
  processReturn,
};
