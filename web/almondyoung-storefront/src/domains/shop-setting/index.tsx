"use client"

import {
  CATEGORIES,
  DAYS_OF_WEEK,
  SHOP_TYPES,
  TARGET_CUSTOMERS,
} from "@/components/shop-form/constants"
import {
  shopFormSchema,
  type ShopFormSchema,
  type ShopFormValues,
} from "@/components/shop-form/schema"
import SurveyHeader from "@/domains/shop-survey/components/surbey-header"
import { modifyShopSurvey } from "@/lib/api/users/shop-suvery"
import { zodResolver } from "@hookform/resolvers/zod"
import { ShopInfoDto } from "@lib/types/dto/users"
import { Building2, Check, Scissors, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

const CATEGORY_KEY: Record<string, string> = {
  헤어: "hair",
  네일: "nail",
  속눈썹: "lash",
  속눈썹연장: "lashExtension",
  반영구: "semiPermanent",
  왁싱: "waxing",
  피부미용: "skincare",
}

const CUSTOMER_KEY: Record<string, string> = {
  여성: "female",
  남성: "male",
  "10대": "teens",
  "20~30대": "twentyToThirty",
  "40대 이상": "fortyPlus",
  아동: "kids",
}

const DAY_KEY: Record<string, string> = {
  월: "mon",
  화: "tue",
  수: "wed",
  목: "thu",
  금: "fri",
  토: "sat",
  일: "sun",
}

export function ShopSettingTemplate({
  shopInfo,
}: {
  shopInfo: ShopInfoDto | null
}) {
  const t = useTranslations("mypage.shopSetting")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { control, handleSubmit, watch, reset } = useForm<ShopFormValues>({
    resolver: zodResolver(shopFormSchema),
    defaultValues: {
      isOperating: undefined,
      yearsOperating: 0,
      shopType: "",
      categories: [],
      targetCustomers: [],
      openDays: [],
    },
  })

  const isOperating = watch("isOperating")

  useEffect(() => {
    if (shopInfo) {
      reset({
        isOperating: shopInfo.isOperating,
        yearsOperating: shopInfo.yearsOperating ?? 0,
        shopType: shopInfo.shopType ?? "",
        categories: shopInfo.categories ?? [],
        targetCustomers: (shopInfo.targetCustomers as string[]) ?? [],
        openDays: (shopInfo.openDays as string[]) ?? [],
      })
    }
  }, [shopInfo, reset])

  const onSubmit = async (data: ShopFormValues) => {
    setIsSubmitting(true)

    const result = await modifyShopSurvey(data as ShopFormSchema)

    setIsSubmitting(false)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success(t("savedSuccess"))
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <SurveyHeader />

      <div className="flex flex-col gap-10 bg-white p-[15px]">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-10"
        >
          {/* 샵 운영 여부 */}
          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="text-base font-bold text-black">
                {t("operationStatus")} <span className="text-red-500">*</span>
              </h2>
            </header>

            <Controller
              name="isOperating"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex gap-2">
                  <legend className="sr-only">{t("operationLegend")}</legend>
                  <button
                    type="button"
                    onClick={() => onChange(true)}
                    className={`flex items-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                      value === true
                        ? "bg-amber-500 font-bold text-white"
                        : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                    }`}
                  >
                    {value === true && <Check className="h-3.5 w-3.5" />}
                    {t("operating")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(false)}
                    className={`flex items-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                      value === false
                        ? "bg-amber-500 font-bold text-white"
                        : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                    }`}
                  >
                    {value === false && <Check className="h-3.5 w-3.5" />}
                    {t("preparing")}
                  </button>
                </fieldset>
              )}
            />

            {isOperating && (
              <>
                <p className="text-xs text-black">{t("yearsHint")}</p>

                <Controller
                  name="yearsOperating"
                  control={control}
                  render={({ field: { value, onChange } }) => (
                    <div className="flex items-center justify-start gap-5">
                      <div
                        className="flex items-start justify-start"
                        role="group"
                      >
                        <button
                          type="button"
                          onClick={() => onChange(Math.max(0, value - 1))}
                          className="relative h-7 w-7 rounded border border-zinc-300"
                        >
                          -
                        </button>

                        <div className="relative mx-2 flex h-7 min-w-[36px] items-center justify-center rounded border border-zinc-300 px-2">
                          <span className="text-xs font-bold text-black">
                            {value}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onChange(value + 1)}
                          className="relative h-7 w-7 rounded border border-zinc-300"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs font-normal text-black">
                        {t("yearsSuffix")}
                      </span>
                    </div>
                  )}
                />
              </>
            )}
          </section>

          {/* 샵 기본 정보 (규모) */}
          <section className="flex w-full flex-col gap-5 md:max-w-[770px]">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Building2 className="h-4 w-4 text-amber-500" />
                {t("basicInfo")}
                <span className="text-red-500">*</span>
              </h2>
            </header>

            <p className="text-xs text-black">{t("storeSize")}</p>

            <Controller
              name="shopType"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {SHOP_TYPES.map(({ value: typeValue }) => (
                    <button
                      key={typeValue}
                      type="button"
                      onClick={() => onChange(typeValue)}
                      className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                        value === typeValue
                          ? "bg-amber-500 font-bold text-white"
                          : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                      }`}
                    >
                      {t(`shopTypes.${typeValue}`)}
                    </button>
                  ))}
                </fieldset>
              )}
            />
          </section>

          {/* 시술 종류 (다중 선택) */}
          <section className="flex w-full flex-col gap-5 md:max-w-[770px]">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Scissors className="h-4 w-4 text-amber-500" />
                {t("shopTypeTitle")}
              </h2>
            </header>

            <p className="text-xs text-black">
              {t("shopTypeHint")}
              <span className="ml-1 text-red-500">*</span>
            </p>

            <Controller
              name="categories"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {CATEGORIES.map((item) => {
                    const isSelected = value.includes(item)
                    const key = CATEGORY_KEY[item] ?? item
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? value.filter((v) => v !== item)
                            : [...value, item]
                          onChange(newValue)
                        }}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          isSelected
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                        }`}
                      >
                        {t(`categories.${key}`)}
                      </button>
                    )
                  })}
                </fieldset>
              )}
            />
          </section>

          {/* 고객층 & 운영 요일 */}
          <section className="flex w-full flex-col gap-5">
            <header>
              <h2 className="flex items-center gap-1 text-base font-bold text-black">
                <Users className="h-4 w-4 text-amber-500" />
                {t("customerInfoTitle")}
              </h2>
            </header>

            <p className="text-xs text-black">{t("mainCustomerHint")}</p>
            <Controller
              name="targetCustomers"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {TARGET_CUSTOMERS.map((target) => {
                    const isSelected = value.includes(target)
                    const key = CUSTOMER_KEY[target] ?? target
                    return (
                      <button
                        key={target}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? value.filter((v) => v !== target)
                            : [...value, target]
                          onChange(newValue)
                        }}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          isSelected
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                        }`}
                      >
                        {t(`customers.${key}`)}
                      </button>
                    )
                  })}
                </fieldset>
              )}
            />

            <p className="text-xs text-black">{t("operatingDays")}</p>
            <Controller
              name="openDays"
              control={control}
              render={({ field: { value, onChange } }) => (
                <fieldset className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const isSelected = value.includes(day)
                    const key = DAY_KEY[day] ?? day
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const newValue = isSelected
                            ? value.filter((v) => v !== day)
                            : [...value, day]
                          onChange(newValue)
                        }}
                        className={`flex items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-xs shadow-[0_4px_4px_rgba(0,0,0,0.1)] transition-colors ${
                          isSelected
                            ? "bg-amber-500 font-bold text-white"
                            : "bg-white font-normal text-gray-600 outline-[0.5px] outline-zinc-300"
                        }`}
                      >
                        {t(`days.${key}`)}
                      </button>
                    )
                  })}
                </fieldset>
              )}
            />
          </section>

          <footer className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-[4px] bg-[#FFA500] px-6 py-3 text-white transition-colors hover:bg-[#FF8C00] disabled:bg-gray-300"
            >
              {isSubmitting ? t("saving") : t("save")}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
