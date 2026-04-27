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

export const listPurchaseOrders = async (
  filters?: PurchaseOrderListFilters
): Promise<PurchaseOrderListResponseDto> => {
  const response = await client.get(
    `${BASE}?${buildQueryString((filters ?? {}) as Record<string, unknown>)}`
  );
  return response.data;
};

export const getPurchaseOrder = async (id: string): Promise<PurchaseOrderDto> => {
  const response = await client.get(`${BASE}/${encodeURIComponent(id)}`);
  return response.data;
};

export const createPurchaseOrder = async (
  data: CreatePurchaseOrderRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.post(BASE, data);
  return response.data;
};

export const createPurchaseOrderFromCart = async (
  data: CreatePurchaseOrderFromCartRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.post(`${BASE}/from-cart`, data);
  return response.data;
};

export const updatePurchaseOrderStatus = async (
  id: string,
  data: UpdatePurchaseOrderStatusRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}/status`, data);
  return response.data;
};

export const updatePurchaseOrderLines = async (
  id: string,
  data: UpdatePurchaseOrderLinesRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}/lines`, data);
  return response.data;
};

export const submitForAudit = async (
  id: string,
  data: SubmitForAuditRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}/submit-for-audit`, data);
  return response.data;
};

export const approvePurchaseOrder = async (
  id: string,
  data: ApprovePoRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}/approve`, data);
  return response.data;
};

export const rejectPurchaseOrder = async (
  id: string,
  data: RejectPoRequest
): Promise<PurchaseOrderDto> => {
  const response = await client.put(`${BASE}/${encodeURIComponent(id)}/reject`, data);
  return response.data;
};

export const listCart = async (type?: string): Promise<CartItemDto[]> => {
  const qs = type ? `?type=${type}` : '';
  const response = await client.get(`${BASE}/cart${qs}`);
  return response.data;
};

export const addToCart = async (data: AddToCartRequest): Promise<CartItemDto> => {
  const response = await client.post(`${BASE}/cart`, data);
  return response.data;
};

export const updateCartItem = async (
  itemId: string,
  data: UpdateCartItemRequest
): Promise<CartItemDto> => {
  const response = await client.put(`${BASE}/cart/${encodeURIComponent(itemId)}`, data);
  return response.data;
};

export const removeCartItem = async (itemId: string): Promise<void> => {
  await client.delete(`${BASE}/cart/${encodeURIComponent(itemId)}`);
};

export const clearCart = async (type?: string): Promise<void> => {
  const qs = type ? `?type=${type}` : '';
  await client.delete(`${BASE}/cart${qs}`);
};

export const getReorderSuggestions = async (
  warehouseId?: string
): Promise<StockReorderSuggestionDto[]> => {
  const qs = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : '';
  const response = await client.get(`${BASE}/suggestions/reorder${qs}`);
  return response.data;
};

export const purchaseOrdersClient = {
  list: listPurchaseOrders,
  get: getPurchaseOrder,
  create: createPurchaseOrder,
  createFromCart: createPurchaseOrderFromCart,
  updateStatus: updatePurchaseOrderStatus,
  updateLines: updatePurchaseOrderLines,
  submitForAudit,
  approve: approvePurchaseOrder,
  reject: rejectPurchaseOrder,
  cart: {
    list: listCart,
    add: addToCart,
    update: updateCartItem,
    remove: removeCartItem,
    clear: clearCart,
  },
  suggestions: {
    reorder: getReorderSuggestions,
  },
};
