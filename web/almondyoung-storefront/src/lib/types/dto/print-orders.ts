// core GET /store/print-orders/file-rejections
export interface PrintFileRejectionDto {
  salesOrderLineId: string
  channelOrderId: string
  channelOrderItemId: string | null
  productName: string
  rejectedAt: string
  jobstat: number | null
  acceptedExtensions: string[]
}
