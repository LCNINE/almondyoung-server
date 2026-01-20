import { HttpTypes } from "@medusajs/types"

export interface ShippingAddressSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddNewAddress: () => void
  onEditAddress: (address: HttpTypes.StoreCustomerAddress) => void
  currentAddressId?: string
}

export interface AddressCardProps {
  address: HttpTypes.StoreCustomerAddress
  isSelected: boolean
  isActionLoading: boolean
  onSelect: () => void
  onEdit: (e: React.MouseEvent) => void
  onSetDefault: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}
