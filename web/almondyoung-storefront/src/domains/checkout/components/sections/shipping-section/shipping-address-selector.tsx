"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMediaQuery } from "@/hooks/use-media-query"
import { updateCart } from "@/lib/api/medusa/cart"
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  setDefaultShippingAddress,
} from "@/lib/api/medusa/customer"
import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import {
  Check,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ShippingAddressSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddNewAddress: () => void
  onEditAddress: (address: HttpTypes.StoreCustomerAddress) => void
  currentAddressId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** 전화번호 포맷팅 (010-1234-5678 형식) */
const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

/** 주소 전체 문자열 생성 */
const buildFullAddress = (address: HttpTypes.StoreCustomerAddress): string => {
  return [address.province, address.city, address.address_1, address.address_2]
    .filter(Boolean)
    .join(" ")
}

/** 이름 전체 문자열 생성 */
const buildFullName = (address: HttpTypes.StoreCustomerAddress): string => {
  return [address.first_name, address.last_name].filter(Boolean).join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <MapPin className="mb-2 h-8 w-8 text-gray-400" />
      <p className="text-gray-500">저장된 배송지가 없습니다.</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-gray-500">불러오는 중...</div>
    </div>
  )
}

interface AddressCardProps {
  address: HttpTypes.StoreCustomerAddress
  isSelected: boolean
  isActionLoading: boolean
  onSelect: () => void
  onEdit: (e: React.MouseEvent) => void
  onSetDefault: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}

function AddressCard({
  address,
  isSelected,
  isActionLoading,
  onSelect,
  onEdit,
  onSetDefault,
  onDelete,
}: AddressCardProps) {
  const fullAddress = buildFullAddress(address)
  const name = buildFullName(address)
  const addressName = address.address_name

  return (
    <div
      onClick={() => !isActionLoading && onSelect()}
      className={cn(
        "relative cursor-pointer rounded-lg border p-4 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-gray-200 hover:border-gray-300",
        isActionLoading && "pointer-events-none opacity-50"
      )}
    >
      <div className="relative flex items-start justify-between">
        <div className="flex-1 pr-8">
          <div className="flex items-center gap-2">
            {addressName ? (
              <span className="font-medium text-gray-900">{addressName}</span>
            ) : null}
            <span
              className={
                addressName
                  ? "text-sm text-gray-600"
                  : "font-medium text-gray-900"
              }
            >
              {name}
            </span>
            {address.is_default_shipping ? (
              <span className="rounded bg-[#e8f6ea] px-2 py-0.5 text-[11px] font-semibold text-[#2ba24c]">
                기본 배송지
              </span>
            ) : null}
          </div>
          {address.phone ? (
            <p className="mt-1 text-sm text-gray-600">
              {formatPhoneNumber(address.phone)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-gray-600">{fullAddress}</p>
        </div>

        <div className="flex items-center gap-1">
          {isSelected ? (
            <Check className="absolute right-6 top-0 h-5 w-5 shrink-0 text-primary" />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1 hover:bg-gray-100"
              >
                <MoreVertical className="h-4 w-4 text-gray-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                수정
              </DropdownMenuItem>
              {!address.is_default_shipping ? (
                <DropdownMenuItem onClick={onSetDefault}>
                  <Star className="mr-2 h-4 w-4" />
                  기본 배송지로 설정
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

interface AddNewAddressButtonProps {
  onClick: () => void
}

function AddNewAddressButton({ onClick }: AddNewAddressButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={onClick}
    >
      <Plus className="mr-2 h-4 w-4" />새 배송지 추가
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ShippingAddressSelector({
  open,
  onOpenChange,
  onAddNewAddress,
  onEditAddress,
  currentAddressId,
}: ShippingAddressSelectorProps) {
  const router = useRouter()
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [addresses, setAddresses] = useState<HttpTypes.StoreCustomerAddress[]>(
    []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    currentAddressId ?? null
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 주소 목록 불러오기
  const fetchAddresses = useCallback(async () => {
    setIsLoading(true)
    const result = await getCustomerAddresses()
    
    if (result) {
      setAddresses(result)
      // 기본 배송지가 있으면 선택 (currentAddressId가 없을 때만)
      if (!currentAddressId) {
        const defaultAddress = result.find((addr) => addr.is_default_shipping)
        if (defaultAddress) {
          setSelectedId(defaultAddress.id)
        }
      }
    }
    setIsLoading(false)
  }, [currentAddressId])

  useEffect(() => {
    if (!open) return
    fetchAddresses()
  }, [open, fetchAddresses])

  const handleSelect = useCallback(async () => {
    if (!selectedId) return

    const selectedAddress = addresses.find((addr) => addr.id === selectedId)
    if (!selectedAddress) return

    setIsSubmitting(true)

    try {
      await updateCart({
        shipping_address: {
          first_name: selectedAddress.first_name ?? "",
          last_name: selectedAddress.last_name ?? "",
          phone: selectedAddress.phone ?? "",
          province: selectedAddress.province ?? "",
          city: selectedAddress.city ?? "",
          address_1: selectedAddress.address_1 ?? "",
          address_2: selectedAddress.address_2 ?? "",
          postal_code: selectedAddress.postal_code ?? "",
          country_code: selectedAddress.country_code ?? "kr",
        },
        metadata: {
          shipping_address_name: selectedAddress.address_name || null,
        },
      })

      toast.success("배송지가 변경되었습니다.")
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("배송지 변경 실패:", error)
      toast.error("배송지 변경에 실패했습니다.")
    } finally {
      setIsSubmitting(false)
    }
  }, [selectedId, addresses, onOpenChange, router])

  const handleEdit = useCallback(
    (e: React.MouseEvent, address: HttpTypes.StoreCustomerAddress) => {
      e.stopPropagation()
      onOpenChange(false)
      onEditAddress(address)
    },
    [onOpenChange, onEditAddress]
  )

  const handleSetDefault = useCallback(
    async (e: React.MouseEvent, addressId: string) => {
      e.stopPropagation()
      setActionLoading(addressId)

      try {
        const result = await setDefaultShippingAddress(addressId)

        if (result.success) {
          toast.success("기본 배송지로 설정되었습니다.")
          await fetchAddresses()
        } else {
          toast.error("기본 배송지 설정에 실패했습니다.")
        }
      } catch (error) {
        console.error("기본 배송지 설정 실패:", error)
        toast.error("기본 배송지 설정에 실패했습니다.")
      } finally {
        setActionLoading(null)
      }
    },
    [fetchAddresses]
  )

  const handleDelete = useCallback(
    async (e: React.MouseEvent, addressId: string) => {
      e.stopPropagation()

      if (!confirm("이 배송지를 삭제하시겠습니까?")) return

      setActionLoading(addressId)

      try {
        const result = await deleteCustomerAddress(addressId)

        if (result.success) {
          toast.success("배송지가 삭제되었습니다.")
          // 삭제된 주소가 선택된 상태였으면 선택 해제
          if (selectedId === addressId) {
            setSelectedId(null)
          }
          await fetchAddresses()
        } else {
          toast.error("배송지 삭제에 실패했습니다.")
        }
      } catch (error) {
        console.error("배송지 삭제 실패:", error)
        toast.error("배송지 삭제에 실패했습니다.")
      } finally {
        setActionLoading(null)
      }
    },
    [selectedId, fetchAddresses]
  )

  const handleAddNew = useCallback(() => {
    onOpenChange(false)
    onAddNewAddress()
  }, [onOpenChange, onAddNewAddress])

  // 컨텐츠 렌더링
  const renderContent = () => {
    if (isLoading) {
      return <LoadingState />
    }

    if (addresses.length === 0) {
      return <EmptyState />
    }

    return (
      <div className="max-h-[400px] space-y-2 overflow-y-auto">
        {addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            isSelected={selectedId === address.id}
            isActionLoading={actionLoading === address.id}
            onSelect={() => setSelectedId(address.id)}
            onEdit={(e) => handleEdit(e, address)}
            onSetDefault={(e) => handleSetDefault(e, address.id)}
            onDelete={(e) => handleDelete(e, address.id)}
          />
        ))}
      </div>
    )
  }

  const content = (
    <div className="space-y-3">
      {renderContent()}
      <AddNewAddressButton onClick={handleAddNew} />
    </div>
  )

  const isSelectDisabled =
    !selectedId || isSubmitting || addresses.length === 0

  // Desktop: Dialog
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>배송지 선택</DialogTitle>
          </DialogHeader>
          <div className="py-4">{content}</div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={handleSelect}
              disabled={isSelectDisabled}
            >
              {isSubmitting ? "변경 중..." : "선택 완료"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Mobile: Drawer
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>배송지 선택</DrawerTitle>
        </DrawerHeader>
        <div className="px-4">{content}</div>
        <DrawerFooter className="pt-4">
          <Button
            type="button"
            onClick={handleSelect}
            disabled={isSelectDisabled}
          >
            {isSubmitting ? "변경 중..." : "선택 완료"}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" disabled={isSubmitting}>
              취소
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
