export interface WishlistDto {
  success: boolean
  data: {
    id: string
    productId: string
    createdAt: string
    updatedAt: string
    userId: string
  }[]
}
