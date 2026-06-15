"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FullScreenDialog,
  FullScreenDialogBody,
  FullScreenDialogContent,
  FullScreenDialogFooter,
  FullScreenDialogHeader,
  FullScreenDialogTitle,
} from "@/components/ui/full-screen-dialog"
import { Form } from "@/components/ui/form"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  createCustomerShippingAddress,
  updateCustomerShippingAddress,
} from "@/lib/api/medusa/customer"
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from "@/lib/utils/locale-path"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { getAddressConfig, type AddressFieldKey } from "./field-config"
import {
  FormTextField,
  PhoneField,
  PostalCodeField,
  SaveAsDefaultField,
} from "./form-fields"
import {
  buildShippingAddressSchema,
  type ShippingAddressFormData,
  type ShippingAddressModalProps,
  type ShippingFormErrorMessages,
} from "./schema"
import { transformFormDataToAddress } from "./utils"

export function ShippingAddressModal({
  open,
  onOpenChange,
  mode = "create",
  addressId,
  defaultValues,
  onSuccess,
}: ShippingAddressModalProps) {
  const router = useRouter()
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const rawLocale = useLocale()
  const locale: SupportedLocale = isSupportedLocale(rawLocale)
    ? rawLocale
    : DEFAULT_LOCALE
  const config = getAddressConfig(locale)
  const t = useTranslations("checkout.shipping.form")
  const tHeader = useTranslations("checkout.header")

  const isEditMode = mode === "edit"
  const modalTitle = t(isEditMode ? "title.edit" : "title.create")
  const submitButtonText = isSubmitting
    ? t(isEditMode ? "submitting.edit" : "submitting.create")
    : t(isEditMode ? "submit.edit" : "submit.create")

  const errorMessages: ShippingFormErrorMessages = useMemo(
    () => ({
      name: t("errors.name"),
      firstName: t("errors.firstName"),
      lastName: t("errors.lastName"),
      phoneRequired: t("errors.phoneRequired"),
      phoneInvalid: t("errors.phoneInvalid"),
      postalCode: t("errors.postalCode"),
      address1: t("errors.address1"),
      city: t("errors.city"),
      province: t("errors.province"),
    }),
    [t]
  )

  const resolver = useMemo(
    () => zodResolver(buildShippingAddressSchema(locale, errorMessages)),
    [locale, errorMessages]
  )

  const form = useForm<ShippingAddressFormData>({
    resolver,
    defaultValues: {
      addressName: "",
      name: "",
      firstName: "",
      lastName: "",
      phone: "",
      postalCode: "",
      address1: "",
      address2: "",
      city: "",
      province: "",
      saveAsDefault: defaultValues?.isDefaultShipping ?? false,
    },
  })

  // 모달 열릴 때 폼 초기화
  useEffect(() => {
    if (!open) return

    const rawPhone = defaultValues?.phone ?? ""
    form.reset({
      addressName: defaultValues?.addressName ?? "",
      name: defaultValues?.name ?? "",
      firstName: defaultValues?.firstName ?? "",
      lastName: defaultValues?.lastName ?? "",
      phone: rawPhone
        ? config.phoneAutoFormat
          ? formatPhoneNumber(rawPhone)
          : rawPhone
        : "",
      postalCode: defaultValues?.postalCode ?? "",
      address1: defaultValues?.address1 ?? "",
      address2: defaultValues?.address2 ?? "",
      city: defaultValues?.city ?? "",
      province: defaultValues?.province ?? "",
      saveAsDefault: defaultValues?.isDefaultShipping ?? false,
    })
  }, [open, defaultValues, form, config.phoneAutoFormat])

  // 배송지 수정
  const handleUpdate = useCallback(
    async (data: ShippingAddressFormData) => {
      if (!addressId) return false

      const addressData = transformFormDataToAddress(data, locale)
      const result = await updateCustomerShippingAddress(addressId, {
        ...addressData,
        is_default_shipping: data.saveAsDefault,
      })

      if (!result.success) {
        toast.error(t("toasts.updateFailed"))
        return false
      }

      toast.success(t("toasts.updated"))
      return true
    },
    [addressId, locale, t]
  )

  const handleCreate = useCallback(
    async (data: ShippingAddressFormData) => {
      const addressData = transformFormDataToAddress(data, locale)
      const result = await createCustomerShippingAddress({
        ...addressData,
        is_default_shipping: data.saveAsDefault ?? false,
      })

      if (!result.success) {
        toast.error(t("toasts.createFailed"))
        return false
      }

      toast.success(
        data.saveAsDefault ? t("toasts.createdDefault") : t("toasts.created")
      )
      return true
    },
    [locale, t]
  )

  const handleSubmit = useCallback(
    async (data: ShippingAddressFormData) => {
      setIsSubmitting(true)

      try {
        const success = isEditMode
          ? await handleUpdate(data)
          : await handleCreate(data)

        if (success) {
          onOpenChange(false)
          router.refresh()
          onSuccess?.()
        }
      } catch (error) {
        console.error("배송지 저장 실패:", error)
        toast.error(t("toasts.saveFailed"))
      } finally {
        setIsSubmitting(false)
      }
    },
    [isEditMode, handleUpdate, handleCreate, onOpenChange, router, onSuccess, t]
  )

  // 우편번호 검색 (ko 전용)
  const handleOpenPostcode = useCallback(() => {
    if (typeof window === "undefined") return

    const daum = (
      window as Window & {
        daum?: {
          Postcode: new (options: {
            oncomplete: (data: {
              zonecode: string
              roadAddress?: string
              jibunAddress?: string
            }) => void
          }) => { open: () => void }
        }
      }
    ).daum

    if (!daum?.Postcode) {
      toast.error(t("toasts.postcodeLoading"))
      return
    }

    new daum.Postcode({
      oncomplete: (data) => {
        form.setValue("postalCode", data.zonecode)
        form.setValue("address1", data.roadAddress ?? data.jibunAddress ?? "")
        form.clearErrors(["postalCode", "address1"])
      },
    }).open()
  }, [form, t])

  const renderField = (key: AddressFieldKey) => {
    switch (key) {
      case "postalCode":
        return config.postalCodeSearch ? (
          <PostalCodeField
            key={key}
            control={form.control}
            placeholder={t("fields.postalCode")}
            searchLabel={t("search")}
            onOpenPostcode={handleOpenPostcode}
          />
        ) : (
          <FormTextField
            key={key}
            control={form.control}
            name="postalCode"
            placeholder={t("fields.postalCode")}
          />
        )
      case "phone":
        return (
          <PhoneField
            key={key}
            control={form.control}
            placeholder={t("fields.phone")}
            autoFormat={config.phoneAutoFormat}
          />
        )
      case "address1":
        return (
          <FormTextField
            key={key}
            control={form.control}
            name="address1"
            placeholder={t("fields.address1")}
            readOnly={config.address1ReadOnly}
          />
        )
      default:
        return (
          <FormTextField
            key={key}
            control={form.control}
            name={key}
            placeholder={t(`fields.${key}`)}
          />
        )
    }
  }

  const formContent = (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-4"
        id="address-form"
      >
        {config.fields.map(renderField)}
        <SaveAsDefaultField
          control={form.control}
          label={t(isEditMode ? "saveAsDefault.edit" : "saveAsDefault.create")}
        />
      </form>
    </Form>
  )

  // Desktop: Dialog
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
          </DialogHeader>
          <div className="py-4">{formContent}</div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" form="address-form" disabled={isSubmitting}>
              {submitButtonText}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Mobile: full-screen dialog
  return (
    <FullScreenDialog open={open} onOpenChange={onOpenChange}>
      <FullScreenDialogContent>
        <FullScreenDialogHeader closeLabel={tHeader("closeAria")}>
          <FullScreenDialogTitle>{modalTitle}</FullScreenDialogTitle>
        </FullScreenDialogHeader>
        <FullScreenDialogBody>{formContent}</FullScreenDialogBody>
        <FullScreenDialogFooter>
          <Button type="submit" form="address-form" disabled={isSubmitting}>
            {submitButtonText}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
        </FullScreenDialogFooter>
      </FullScreenDialogContent>
    </FullScreenDialog>
  )
}
