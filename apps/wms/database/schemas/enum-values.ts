import {
  returnStatusEnum,
  sourceTypeEnum,
  eventStatusEnum,
  stockStateEnum,
  transitionTypeEnum,
  eventTypeEnum,
  warehouseTypeEnum,
  reservationStatusEnum,
  taskStatusEnum,
  unavailableReasonEnum,
  shipmentStatusEnum,
  carrierEnum,
  matchingStatusEnum,
  matchingPriorityEnum,
  matchingStrategyEnum,
  settingKeyEnum,
  poTypeEnum,
  poStatusEnum,
  poAuditStatusEnum,
  inboundStatusEnum,
  stockTypeEnum,
  planTypeEnum,
  stocktakingStatusEnum,
  inboundMethodEnum,
  inboundReceiptStatusEnum,
  inboundWorkTypeEnum,
  locationTypeEnum,
  systemLocationRoleEnum,
  orderStatusEnum,
  orderItemStatusEnum,
  salesChannelEnum,
  eventTypeOrderEnum,
  taskPriorityEnum,
  fulfillmentStatusEnum,
  fulfillmentModeEnum,
  outboxStatusEnum,
  pickingMethodEnum,
  batchStatusEnum,
  invoiceMethodEnum,
  invoiceStatusEnum,
  auditEventTypeEnum,
  auditSeverityEnum,
} from "./wms-schema";

export const returnStatusValues = returnStatusEnum.enumValues;
export type ReturnStatusEnum = (typeof returnStatusValues)[number];

export const sourceTypeValues = sourceTypeEnum.enumValues;
export type SourceTypeEnum = (typeof sourceTypeValues)[number];

export const eventStatusValues = eventStatusEnum.enumValues;
export type EventStatusEnum = (typeof eventStatusValues)[number];

export const stockStateValues = stockStateEnum.enumValues;
export type StockStateEnum = (typeof stockStateValues)[number];

export const transitionTypeValues = transitionTypeEnum.enumValues;
export type TransitionTypeEnum = (typeof transitionTypeValues)[number];

export const eventTypeValues = eventTypeEnum.enumValues;
export type EventTypeEnum = (typeof eventTypeValues)[number];

export const warehouseTypeValues = warehouseTypeEnum.enumValues;
export type WarehouseTypeEnum = (typeof warehouseTypeValues)[number];

export const reservationStatusValues = reservationStatusEnum.enumValues;
export type ReservationStatusEnum = (typeof reservationStatusValues)[number];

export const taskStatusValues = taskStatusEnum.enumValues;
export type TaskStatusEnum = (typeof taskStatusValues)[number];

export const unavailableReasonValues = unavailableReasonEnum.enumValues;
export type UnavailableReasonEnum = (typeof unavailableReasonValues)[number];

export const shipmentStatusValues = shipmentStatusEnum.enumValues;
export type ShipmentStatusEnum = (typeof shipmentStatusValues)[number];

export const carrierValues = carrierEnum.enumValues;
export type CarrierEnum = (typeof carrierValues)[number];

export const matchingStatusValues = matchingStatusEnum.enumValues;
export type MatchingStatusEnum = (typeof matchingStatusValues)[number];

export const matchingPriorityValues = matchingPriorityEnum.enumValues;
export type MatchingPriorityEnum = (typeof matchingPriorityValues)[number];

export const matchingStrategyValues = matchingStrategyEnum.enumValues;
export type MatchingStrategyEnum = (typeof matchingStrategyValues)[number];

export const settingKeyValues = settingKeyEnum.enumValues;
export type SettingKeyEnum = (typeof settingKeyValues)[number];

export const poTypeValues = poTypeEnum.enumValues;
export type PoTypeEnum = (typeof poTypeValues)[number];

export const poStatusValues = poStatusEnum.enumValues;
export type PoStatusEnum = (typeof poStatusValues)[number];

export const poAuditStatusValues = poAuditStatusEnum.enumValues;
export type PoAuditStatusEnum = (typeof poAuditStatusValues)[number];

export const inboundStatusValues = inboundStatusEnum.enumValues;
export type InboundStatusEnum = (typeof inboundStatusValues)[number];

export const stockTypeValues = stockTypeEnum.enumValues;
export type StockTypeEnum = (typeof stockTypeValues)[number];

export const planTypeValues = planTypeEnum.enumValues;
export type PlanTypeEnum = (typeof planTypeValues)[number];

export const stocktakingStatusValues = stocktakingStatusEnum.enumValues;
export type StocktakingStatusEnum = (typeof stocktakingStatusValues)[number];

export const inboundMethodValues = inboundMethodEnum.enumValues;
export type InboundMethodEnum = (typeof inboundMethodValues)[number];

export const inboundReceiptStatusValues = inboundReceiptStatusEnum.enumValues;
export type InboundReceiptStatusEnum = (typeof inboundReceiptStatusValues)[number];

export const inboundWorkTypeValues = inboundWorkTypeEnum.enumValues;
export type InboundWorkTypeEnum = (typeof inboundWorkTypeValues)[number];

export const locationTypeValues = locationTypeEnum.enumValues;
export type LocationTypeEnum = (typeof locationTypeValues)[number];

export const systemLocationRoleValues = systemLocationRoleEnum.enumValues;
export type SystemLocationRoleEnum = (typeof systemLocationRoleValues)[number];

export const orderStatusValues = orderStatusEnum.enumValues;
export type OrderStatusEnum = (typeof orderStatusValues)[number];

export const orderItemStatusValues = orderItemStatusEnum.enumValues;
export type OrderItemStatusEnum = (typeof orderItemStatusValues)[number];

export const salesChannelValues = salesChannelEnum.enumValues;
export type SalesChannelEnum = (typeof salesChannelValues)[number];

export const eventTypeOrderValues = eventTypeOrderEnum.enumValues;
export type EventTypeOrderEnum = (typeof eventTypeOrderValues)[number];

export const taskPriorityValues = taskPriorityEnum.enumValues;
export type TaskPriorityEnum = (typeof taskPriorityValues)[number];

export const fulfillmentStatusValues = fulfillmentStatusEnum.enumValues;
export type FulfillmentStatusEnum = (typeof fulfillmentStatusValues)[number];

export const fulfillmentModeValues = fulfillmentModeEnum.enumValues;
export type FulfillmentModeEnum = (typeof fulfillmentModeValues)[number];

export const outboxStatusValues = outboxStatusEnum.enumValues;
export type OutboxStatusEnum = (typeof outboxStatusValues)[number];

export const pickingMethodValues = pickingMethodEnum.enumValues;
export type PickingMethodEnum = (typeof pickingMethodValues)[number];

export const batchStatusValues = batchStatusEnum.enumValues;
export type BatchStatusEnum = (typeof batchStatusValues)[number];

export const invoiceMethodValues = invoiceMethodEnum.enumValues;
export type InvoiceMethodEnum = (typeof invoiceMethodValues)[number];

export const invoiceStatusValues = invoiceStatusEnum.enumValues;
export type InvoiceStatusEnum = (typeof invoiceStatusValues)[number];

export const auditEventTypeValues = auditEventTypeEnum.enumValues;
export type AuditEventTypeEnum = (typeof auditEventTypeValues)[number];

export const auditSeverityValues = auditSeverityEnum.enumValues;
export type AuditSeverityEnum = (typeof auditSeverityValues)[number];
