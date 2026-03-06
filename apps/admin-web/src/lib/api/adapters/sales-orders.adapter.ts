/** @format */

import {
  OrderSalesChannel,
  SalesOrderDto,
  SalesOrdersResponseDto,
  SalesOrderStatus,
} from '../../types/dto/orders';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// TODO: 추후 위치 이동 예정
export class SalesOrderAdapter {
  private readonly _id: string;
  private readonly _status: SalesOrderStatus;
  private readonly _salesChannel: OrderSalesChannel;
  private readonly _channelOrderId: string;
  private readonly _customerName: string | null;
  private readonly _customerEmail: string | null;
  private readonly _customerPhone: string | null;
  private readonly _shippingAddress: {
    address_1: string;
    address_2: string;
    city: string;
    country_code: string;
    postal_code: string;
    province: string;
  };
  private readonly _shippingAddressHash: string | null;
  private readonly _totalAmount: number | null;
  private readonly _shippingFee: number;
  private readonly _mergeGroupId: string | null;
  private readonly _isMerged: boolean;
  private readonly _orderDate: Date;
  private readonly _lines: {
    variantId: string;
    productMatchingId?: string;
    productName?: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
  }[];
  private readonly _confirmedAt: string | null;
  private readonly _processedAt: string | null;
  private readonly _createdAt: string;
  private readonly _updatedAt: string;

  constructor(order: SalesOrderDto) {
    this._id = order.id;
    this._status = order.status;
    this._salesChannel = order.salesChannel;
    this._channelOrderId = order.channelOrderId;
    this._customerName = order.customerName;
    this._customerEmail = order.customerEmail;
    this._customerPhone = order.customerPhone;
    this._shippingAddress = JSON.parse(order.shippingAddress);
    this._shippingAddressHash = order.shippingAddressHash;
    this._totalAmount = order.totalAmount;
    this._shippingFee = order.shippingFee;
    this._mergeGroupId = order.mergeGroupId;
    this._isMerged = order.isMerged;
    this._orderDate = order.orderDate;
    this._lines = order.lines;
    this._confirmedAt = null; // TODO: SalesOrderDto에 추가 필요
    this._processedAt = null; // TODO: SalesOrderDto에 추가 필요
    this._createdAt = order.createdAt;
    this._updatedAt = order.updatedAt;
  }

  get id() {
    return this._id;
  }

  get status() {
    const SALES_ORDER_STATUS_KR = {
      created: '주문 생성',
      confirmed: '출고 지시',
      picking: '출고 작업중',
      shipped: '배송중',
      delivered: '출고완료',
      canceled: '출고 취소됨',
      returned: '반품',
    } as const;

    return SALES_ORDER_STATUS_KR[this._status];
  }

  get salesChannel() {
    const SALES_CHANNEL_KR = {
      medusa: 'almondyoung',
      naver: 'naver_smartstore',
      coupang: 'coupang',
      '3pl': 'other',
      phone_order: 'phone_order',
    } as const;

    return (
      SALES_CHANNEL_KR[
        this._salesChannel.type as keyof typeof SALES_CHANNEL_KR
      ] || { icon: '/icons/other.svg', name: this._salesChannel.name }
    );
  }

  get channelOrderId() {
    return this._channelOrderId;
  }

  get customerName() {
    return this._customerName;
  }

  get customerEmail() {
    return this._customerEmail;
  }

  get customerPhone() {
    return this._customerPhone;
  }

  get shippingAddress() {
    return this._shippingAddress;
  }

  // 주소를 문자열로 포맷팅
  get shippingAddressText() {
    const addr = this._shippingAddress;

    return `${addr.province} ${addr.city} ${addr.address_1}${
      addr.address_2 ? ' ' + addr.address_2 : ''
    }`;
  }

  // 우편번호
  get postalCode() {
    return this._shippingAddress.postal_code;
  }

  get shippingAddressHash() {
    return this._shippingAddressHash;
  }

  get totalAmount() {
    return this._totalAmount;
  }

  get shippingFee() {
    return this._shippingFee;
  }

  get mergeGroupId() {
    return this._mergeGroupId;
  }

  get isMerged() {
    return this._isMerged;
  }

  get orderDate() {
    return format(new Date(this._orderDate), 'yyyy-MM-dd HH:mm', {
      locale: ko,
    });
  }

  get lines() {
    return this._lines;
  }

  get confirmedAt() {
    return this._confirmedAt;
  }

  get processedAt() {
    return this._processedAt;
  }

  get createdAt() {
    return this._createdAt;
  }

  get updatedAt() {
    return this._updatedAt;
  }
}
