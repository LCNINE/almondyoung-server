import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  PurchaseOrderDto,
  PurchaseOrderListResponseDto,
  PurchaseOrderListFilters,
  CreatePurchaseOrderRequest,
  UpdatePurchaseOrderStatusRequest,
  UpdatePurchaseOrderLinesRequest,
  AddToCartRequest,
  UpdateCartItemRequest,
  CreatePurchaseOrderFromCartRequest,
  SubmitForAuditRequest,
  ApprovePoRequest,
  RejectPoRequest,
  CartItemDto,
  StockReorderSuggestionDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/purchase-orders`;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const purchaseOrdersClient = {
  list: async (filters?: PurchaseOrderListFilters): Promise<PurchaseOrderListResponseDto> => {
    const response = await client.get(
      `${BASE}?${buildQueryString((filters ?? {}) as Record<string, unknown>)}`
    );
    return response.data;
  },

  get: async (id: string): Promise<PurchaseOrderDto> => {
    const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return response.data;
  },

  create: async (data: CreatePurchaseOrderRequest): Promise<PurchaseOrderDto> => {
    const response = await client.post(BASE, data);
    return response.data;
  },

  createFromCart: async (
    data: CreatePurchaseOrderFromCartRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.post(`${BASE}/from-cart`, data);
    return response.data;
  },

  updateStatus: async (
    id: string,
    data: UpdatePurchaseOrderStatusRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}/status`, data);
    return response.data;
  },

  updateLines: async (
    id: string,
    data: UpdatePurchaseOrderLinesRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}/lines`, data);
    return response.data;
  },

  submitForAudit: async (
    id: string,
    data: SubmitForAuditRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}/submit-for-audit`, data);
    return response.data;
  },

  approve: async (id: string, data: ApprovePoRequest): Promise<PurchaseOrderDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}/approve`, data);
    return response.data;
  },

  reject: async (id: string, data: RejectPoRequest): Promise<PurchaseOrderDto> => {
    const response = await client.put(`${BASE}/${encodeURIComponent(id)}/reject`, data);
    return response.data;
  },

  cart: {
    list: async (type?: string): Promise<CartItemDto[]> => {
      const qs = type ? `?type=${type}` : '';
      const response = await client.get(`${BASE}/cart${qs}`);
      return response.data;
    },

    add: async (data: AddToCartRequest): Promise<CartItemDto> => {
      const response = await client.post(`${BASE}/cart`, data);
      return response.data;
    },

    update: async (itemId: string, data: UpdateCartItemRequest): Promise<CartItemDto> => {
      const response = await client.put(`${BASE}/cart/${encodeURIComponent(itemId)}`, data);
      return response.data;
    },

    remove: async (itemId: string): Promise<void> => {
      await client.delete(`${BASE}/cart/${encodeURIComponent(itemId)}`);
    },

    clear: async (type?: string): Promise<void> => {
      const qs = type ? `?type=${type}` : '';
      await client.delete(`${BASE}/cart${qs}`);
    },
  },

  suggestions: {
    reorder: async (warehouseId?: string): Promise<StockReorderSuggestionDto[]> => {
      const qs = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
      const response = await client.get(`${BASE}/suggestions/reorder${qs}`);
      return response.data;
    },
  },
};
