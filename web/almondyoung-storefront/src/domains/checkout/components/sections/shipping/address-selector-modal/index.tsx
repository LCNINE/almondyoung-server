"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { useMediaQuery } from "@/hooks/use-media-query"
import { updateCart } from "@/lib/api/medusa/cart"
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  setDefaultShippingAddress,
} from "@/lib/api/medusa/customer"
import { HttpTypes } from "@medusajs/types"
import {
  AddNewAddressButton,
  AddressCard,
  EmptyState,
  LoadingState,
} from "./components"
import type { ShippingAddressSelectorProps } from "./types"

export function ShippingAddressSelectorModal({
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const fetchAddresses = useCallback(async () => {
    setIsLoading(true)
    const result = await getCustomerAddresses()

    if (result) {
      setAddresses(result)

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

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, addressId: string) => {
      e.stopPropagation()
      setDeleteConfirmId(addressId)
    },
    []
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return

    setActionLoading(deleteConfirmId)
    setDeleteConfirmId(null)

    try {
      const result = await deleteCustomerAddress(deleteConfirmId)

      if (result.success) {
        toast.success("배송지가 삭제되었습니다.")
        if (selectedId === deleteConfirmId) {
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
  }, [deleteConfirmId, selectedId, fetchAddresses])

  const handleAddNew = useCallback(() => {
    onOpenChange(false)
    onAddNewAddress()
  }, [onOpenChange, onAddNewAddress])

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
            onDelete={(e) => handleDeleteClick(e, address.id)}
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

  const isSelectDisabled = !selectedId || isSubmitting || addresses.length === 0

  const deleteConfirmDialog = (
    <AlertDialog
      open={!!deleteConfirmId}
      onOpenChange={(open) => !open && setDeleteConfirmId(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>배송지 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            이 배송지를 삭제하시겠습니까? 삭제된 배송지는 복구할 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-red-600 hover:bg-red-700"
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (isDesktop) {
    return (
      <>
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
        {deleteConfirmDialog}
      </>
    )
  }

  return (
    <>
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
      {deleteConfirmDialog}
    </>
  )
}
