"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
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
  FullScreenDialog,
  FullScreenDialogBody,
  FullScreenDialogContent,
  FullScreenDialogFooter,
  FullScreenDialogHeader,
  FullScreenDialogTitle,
} from "@/components/ui/full-screen-dialog"
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
  cartId,
  open,
  onOpenChange,
  onAddNewAddress,
  onEditAddress,
  currentAddressId,
}: ShippingAddressSelectorProps) {
  const t = useTranslations("checkout.shipping.selector")
  const router = useRouter()
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
    const selectedAddressName =
      (selectedAddress.metadata?.shipping_address_name as string) ??
      selectedAddress.address_name

    setIsSubmitting(true)

    try {
      await updateCart(
        {
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
            shipping_address_name: selectedAddressName || null,
          },
        },
        cartId
      )

      toast.success(t("toasts.changed"))
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("배송지 변경 실패:", error)
      toast.error(t("toasts.changeFailed"))
    } finally {
      setIsSubmitting(false)
    }
  }, [selectedId, addresses, onOpenChange, router, cartId, t])

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
          toast.success(t("toasts.defaultSet"))
          await fetchAddresses()
        } else {
          toast.error(t("toasts.defaultSetFailed"))
        }
      } catch (error) {
        console.error("기본 배송지 설정 실패:", error)
        toast.error(t("toasts.defaultSetFailed"))
      } finally {
        setActionLoading(null)
      }
    },
    [fetchAddresses, t]
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
        toast.success(t("toasts.deleted"))
        if (selectedId === deleteConfirmId) {
          setSelectedId(null)
        }
        await fetchAddresses()
      } else {
        toast.error(t("toasts.deleteFailed"))
      }
    } catch (error) {
      console.error("배송지 삭제 실패:", error)
      toast.error(t("toasts.deleteFailed"))
    } finally {
      setActionLoading(null)
    }
  }, [deleteConfirmId, selectedId, fetchAddresses, t])

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
      <div className="space-y-2">
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
          <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDialog.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-red-600 hover:bg-red-700"
          >
            {t("deleteDialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return (
    <>
      <FullScreenDialog open={open} onOpenChange={onOpenChange}>
        <FullScreenDialogContent className="lg:inset-x-auto lg:top-1/2 lg:left-1/2 lg:h-auto lg:max-h-[80dvh] lg:w-[560px] lg:-translate-x-1/2 lg:-translate-y-1/2">
          <FullScreenDialogHeader closeLabel={t("cancel")}>
            <FullScreenDialogTitle>{t("title")}</FullScreenDialogTitle>
          </FullScreenDialogHeader>

          <FullScreenDialogBody>{content}</FullScreenDialogBody>

          <FullScreenDialogFooter>
            <Button
              type="button"
              onClick={handleSelect}
              disabled={isSelectDisabled}
              className="h-12 w-full rounded bg-[#ff6600] text-[15px] font-bold text-white hover:bg-[#ff6600]/90"
            >
              {isSubmitting ? t("changing") : t("selectDone")}
            </Button>
          </FullScreenDialogFooter>
        </FullScreenDialogContent>
      </FullScreenDialog>
      {deleteConfirmDialog}
    </>
  )
}
