"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ShopListingMarkdown } from "@/domains/shop-trade/components/listing-markdown"
import {
  EMPTY_SHOP_LISTING_FORM,
  buildMemberPayload,
  formValuesFromListing,
  type ShopListingFormField,
  type ShopListingFormValues,
} from "@/domains/shop-trade/listing-form"
import { editRequiresReReview } from "@/domains/shop-trade/my-listing-status"
import {
  createMyShopListing,
  getMyShopListing,
  updateMyShopListing,
} from "@/lib/api/ugc/my-shop-listings"
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  type MyShopListingItem,
} from "@/lib/types/ui/shop-listing"
import { cn } from "@/lib/utils"
import { ImagePicker } from "./image-picker"

const INPUT = "bg-muted border-border rounded-lg"

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-foreground text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}

export function ShopListingFormView({
  listing,
  countryCode,
}: {
  listing?: MyShopListingItem
  countryCode: string
}) {
  const t = useTranslations("shopTrade")
  const tf = useTranslations("shopTrade.form")
  const router = useRouter()
  const [values, setValues] = useState<ShopListingFormValues>(
    listing ? formValuesFromListing(listing) : EMPTY_SHOP_LISTING_FORM
  )
  const [invalid, setInvalid] = useState<ShopListingFormField | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const set = <K extends keyof ShopListingFormValues>(key: K, value: ShopListingFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    if (invalid === key) setInvalid(null)
  }

  const submit = () => {
    const built = buildMemberPayload(values)
    if (!built.ok) {
      setInvalid(built.field)
      toast.error(tf(`invalid.${built.field}`))
      return
    }

    startTransition(async () => {
      const result = listing
        ? await updateMyShopListing(listing.id, built.payload)
        : await createMyShopListing(built.payload)

      if (!result.ok) {
        if (result.status === 401) {
          // 루트 error.tsx 가 토큰을 복구한다 — CLAUDE.md §6
          throw new Error("UNAUTHORIZED")
        }
        if (listing && result.status === 409) {
          // 수정 중 관리자가 숨겼을 수 있다(spec §7.3) — 최신 상태를 다시 봐서 갈 곳을 가른다.
          // 한도 초과 같은 다른 409 면 폼에 남아 고쳐 쓰게 둔다.
          toast.error(result.message || tf("submitFail"))
          const latest = await getMyShopListing(listing.id)
          if (!latest.ok || latest.data.status === "hidden") {
            router.push(`/${countryCode}/mypage/shop-listings`)
          }
          return
        }
        // 한도 초과·검증(400)은 서버 문구가 정확하다
        toast.error(result.message || tf("submitFail"))
        return
      }
      toast.success(listing ? tf("updated") : tf("created"))
      router.push(`/${countryCode}/mypage/shop-listings`)
      router.refresh()
    })
  }

  const onSubmitClick = () => {
    if (listing && editRequiresReReview(listing.status)) {
      setConfirmOpen(true)
      return
    }
    submit()
  }

  const money = (key: "deposit" | "monthlyRent" | "keyMoney" | "areaPyeong", unit: string) => (
    <div className="relative">
      <Input
        inputMode="numeric"
        value={values[key]}
        onChange={(e) => set(key, e.target.value.replace(/\D/g, ""))}
        className={cn(INPUT, "pr-12")}
      />
      <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-xs">
        {unit}
      </span>
    </div>
  )

  return (
    <div className="grid gap-6 px-4 py-6 md:px-0">
      <h1 className="text-foreground text-lg font-bold">
        {listing ? tf("editTitle") : tf("newTitle")}
      </h1>

      <Field label={tf("title")} required>
        <Input
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={tf("titlePlaceholder")}
          aria-invalid={invalid === "title"}
          className={INPUT}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={tf("region")} required>
          <Select value={values.region} onValueChange={(v) => set("region", v as ShopListingFormValues["region"])}>
            <SelectTrigger aria-invalid={invalid === "region"} className={INPUT}>
              <SelectValue placeholder={tf("select")} />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_REGIONS.map((r) => (
                <SelectItem key={r} value={r}>{t(`regions.${r}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={tf("businessType")} required>
          <Select value={values.businessType} onValueChange={(v) => set("businessType", v as ShopListingFormValues["businessType"])}>
            <SelectTrigger aria-invalid={invalid === "businessType"} className={INPUT}>
              <SelectValue placeholder={tf("select")} />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_BUSINESS_TYPES.map((b) => (
                <SelectItem key={b} value={b}>{t(`businessTypes.${b}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={tf("dealType")} required>
          <Select value={values.dealType} onValueChange={(v) => set("dealType", v as ShopListingFormValues["dealType"])}>
            <SelectTrigger className={INPUT}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOP_LISTING_DEAL_TYPES.map((d) => (
                <SelectItem key={d} value={d}>{t(`dealTypes.${d}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={tf("areaPyeong")}>{money("areaPyeong", tf("pyeongUnit"))}</Field>
          <Field label={tf("deposit")}>{money("deposit", tf("manwon"))}</Field>
          <Field label={tf("monthlyRent")}>{money("monthlyRent", tf("manwon"))}</Field>
          <Field label={tf("keyMoney")}>{money("keyMoney", tf("manwon"))}</Field>
        </div>
        <p className="text-muted-foreground text-xs">{tf("moneyHint")}</p>
      </div>

      <Field label={tf("images")} required>
        <ImagePicker
          value={values.imageFileIds}
          onChange={(next) => set("imageFileIds", next)}
          invalid={invalid === "imageFileIds"}
        />
      </Field>

      <Field label={tf("content")} required>
        <Tabs defaultValue="write">
          <TabsList>
            <TabsTrigger value="write">{tf("write")}</TabsTrigger>
            <TabsTrigger value="preview">{tf("preview")}</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              value={values.content}
              onChange={(e) => set("content", e.target.value)}
              placeholder={tf("contentPlaceholder")}
              aria-invalid={invalid === "content"}
              rows={12}
              className={INPUT}
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="border-border min-h-[240px] rounded-lg border p-4">
              {values.content.trim() ? (
                <ShopListingMarkdown content={values.content} />
              ) : (
                <p className="text-muted-foreground text-sm">{tf("previewEmpty")}</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Field>

      <Field label={tf("contactPhone")} required hint={tf("contactHint")}>
        <Input
          inputMode="tel"
          value={values.contactPhone}
          onChange={(e) => set("contactPhone", e.target.value)}
          placeholder={tf("contactPhonePlaceholder")}
          aria-invalid={invalid === "contactPhone"}
          className={INPUT}
        />
      </Field>

      <Field label={tf("kakaoOpenChatUrl")}>
        <Input
          inputMode="url"
          value={values.kakaoOpenChatUrl}
          onChange={(e) => set("kakaoOpenChatUrl", e.target.value)}
          placeholder={tf("kakaoPlaceholder")}
          aria-invalid={invalid === "kakaoOpenChatUrl"}
          className={INPUT}
        />
      </Field>

      <Button
        onClick={onSubmitClick}
        disabled={isPending}
        className="h-[52px] w-full rounded-xl text-base font-bold"
      >
        {listing ? tf("submitEdit") : tf("submitNew")}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tf("reReviewTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tf("reReviewBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tf("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                submit()
              }}
            >
              {tf("submitEdit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
