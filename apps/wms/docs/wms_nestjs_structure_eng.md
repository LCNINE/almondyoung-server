# WMS Module and Service Responsibilities

## InventoryModule
Manages inventory status, SKU matching, and location operations.

- **InventoryController**: API for inventory inquiry and adjustment.
- **ProductMatchingController**: API for PIM product-SKU matching.
- **InventoryService**: Calculates available stock, processes stock increases/decreases, and verifies inventory.
- **ProductMatchingService**: Matches PIM products with WMS SKUs and manages matching status.
- **StockEventService**: Creates stock events and recalculates stock based on events.
- **LocationService**: Finds optimal locations, manages FIFO ranking, and manages location capacity.

## ReservationModule
Collects orders, matches products, allocates stock, and manages baskets.

- **OrderCollectController**: API for order collection and product matching.
- **ReservationController**: API for stock reservation, confirmation, and cancellation.
- **OrderCollectService**: Collects orders and manages order status.
- **ReservationService**: Allocates stock, and creates/confirms/releases reservations.
- **BasketService**: Creates/merges/splits baskets and calculates basket weight.

## OutboundModule
Manages the outbound process.

- **OutboundController**: API for outbound lists and outbound job status management.
- **PickingController**: API for picking lists and picking progress.
- **OutboundService**: Creates outbound lists, creates picking lists, and manages the outbound job lifecycle.
- **PickingService**: Processes barcode scans and updates picking progress.
- **PackingService**: Handles packing, calculates box sizes, and requests invoices.

## MovementModule
Handles stock movement within the warehouse.

- **MovementController**: API for creating movement jobs and tracking progress.
- **MovementService**: Creates/starts/compleles movement jobs and tracks progress.

## ShipmentModule
Handles shipping labels and tracking.

- **ShipmentController**: API for shipping labels and shipment status tracking.
- **ShipmentService**: Creates shipping labels, updates shipping status, and calculates ETAs.
- **CarrierService**: Integrates with carrier APIs and parses tracking information.

## InboundModule
Manages inbound and purchase orders.

- **InboundController**: API for inbound processing and inbound lists.
- **PurchaseOrderController**: API for creating and managing purchase orders.
- **InboundService**: Processes inbounds, creates inbound lists, and scans inbound barcodes.
- **PurchaseOrderService**: Creates purchase orders, manages expected inbound dates, and suggests reorders.

## ReturnModule
Handles return reception and processing.

- **ReturnController**: API for return registration and quality inspection.
- **ReturnService**: Processes return requests, handles return inbound, performs quality inspection, and restores stock.

## SharedModule
Common utilities and services.

- **BarcodeService**: Creates barcodes, verifies barcodes, and prints labels.
- **WeightCalculatorService**: Calculates product weight and recommends box sizes.
- **FifoService**: FIFO stock allocation logic.
- **TransactionService**: Manages database transactions.
- **AuditService**: Logs changes and tracks audits.
