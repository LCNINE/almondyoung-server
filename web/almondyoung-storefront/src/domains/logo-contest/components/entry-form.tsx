"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { uploadFile } from "@/lib/api/file/upload"
import { createLogoContestEntry } from "@/lib/api/ugc/logo-contest"
import {
  LOGO_CONTEST_DESCRIPTION_MAX_LENGTH,
  LOGO_CONTEST_ACCEPTED_IMAGE_TYPES,
  LOGO_CONTEST_MAX_IMAGES,
  LOGO_CONTEST_MAX_IMAGE_SIZE_MB,
  LOGO_CONTEST_TITLE_MAX_LENGTH,
} from "@/lib/types/ui/logo-contest"
import { useUser } from "@/contexts/user-context"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { ImagePlus, X } from "lucide-react"
import { toast } from "sonner"
import { validateEntry, type FieldErrors } from "./entry-validation"

const LOGO_CONTEST_IMAGE_CONTEXT_ID = "logo-contest-image"
type ImagePreview = { file: File; previewUrl: string }

export function EntryForm({ countryCode }: { countryCode: string }) {
  const t = useTranslations("logoContest.form")
  const router = useRouter()
  const { user } = useUser()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<(ImagePreview | null)[]>([null, null])
  const [agreed, setAgreed] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [isPending, startTransition] = useTransition()
  const imageUrls = useRef(new Set<string>())

  useEffect(() => {
    const urls = imageUrls.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const handleSubmit = () => {
    const invalid = validateEntry(
      {
        title,
        description,
        hasWordmark: !!images[0],
        hasIcon: !!images[1],
        agreed,
      },
      {
        nameRequired: t("nameRequired"),
        nameTooLong: t("nameTooLong", { max: LOGO_CONTEST_TITLE_MAX_LENGTH }),
        descriptionTooLong: t("descriptionTooLong", {
          max: LOGO_CONTEST_DESCRIPTION_MAX_LENGTH,
        }),
        wordmarkRequired: t("wordmarkRequired"),
        iconRequired: t("iconRequired"),
        agreeRequired: t("agreeRequired"),
      }
    )
    setErrors(invalid)
    const firstInvalid = (
      ["wordmark", "icon", "title", "description", "agreed"] as const
    ).find((field) => invalid[field])
    if (firstInvalid) {
      const fieldIds = {
        wordmark: "logo-contest-image-0",
        icon: "logo-contest-image-1",
        title: "logo-contest-title",
        description: "logo-contest-description",
        agreed: "logo-contest-agree",
      }
      const target = document.getElementById(fieldIds[firstInvalid])
      target?.focus({ preventScroll: true })
      const scrollTarget = target?.closest("label") ?? target
      scrollTarget?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
      return
    }

    startTransition(async () => {
      try {
        const uploaded = await Promise.all(
          images
            .filter((image): image is ImagePreview => !!image)
            .map((image) => {
              const formData = new FormData()
              formData.append("file", image.file)
              formData.append("contextId", LOGO_CONTEST_IMAGE_CONTEXT_ID)
              return uploadFile(formData)
            })
        ).catch(() => null)

        if (!uploaded) {
          toast.error(t("uploadFail"))
          return
        }

        const result = await createLogoContestEntry({
          title: title.trim(),
          description: description.trim() || undefined,
          mediaFileIds: uploaded.map((file) => file.id),
          authorName: user?.username || user?.nickname || "",
          agreed: true,
        })

        if (!result.ok) {
          toast.error(result.message)
          return
        }

        toast.success(t("done"))
        router.push(`/${countryCode}/logo-contest/${result.data.id}`)
        router.refresh()
      } catch (caught: unknown) {
        const err = caught as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw caught
        }
        toast.error(t("fail"))
      }
    })
  }

  const changeImage = async (index: number, file: File | null) => {
    const field = index === 0 ? "wordmark" : "icon"
    if (
      file &&
      (!LOGO_CONTEST_ACCEPTED_IMAGE_TYPES.split(",").includes(file.type) ||
        file.size > LOGO_CONTEST_MAX_IMAGE_SIZE_MB * 1024 * 1024)
    ) {
      setErrors((current) => ({
        ...current,
        [field]: t("fileInvalid", { size: LOGO_CONTEST_MAX_IMAGE_SIZE_MB }),
      }))
      return
    }
    if (file) {
      const bitmap = await createImageBitmap(file).catch(() => null)
      if (!bitmap) {
        setErrors((current) => ({ ...current, [field]: t("fileUnreadable") }))
        return
      }
      const invalidShape =
        index === 0
          ? bitmap.width <= bitmap.height
          : bitmap.width !== bitmap.height
      bitmap.close()
      if (invalidShape) {
        setErrors((current) => ({
          ...current,
          [field]: t(index === 0 ? "wordmarkShape" : "iconShape"),
        }))
        return
      }
    }
    const previous = images[index]
    if (previous) {
      URL.revokeObjectURL(previous.previewUrl)
      imageUrls.current.delete(previous.previewUrl)
    }
    const previewUrl = file ? URL.createObjectURL(file) : null
    if (previewUrl) imageUrls.current.add(previewUrl)
    if (file)
      setErrors((current) => ({
        ...current,
        [field]: undefined,
      }))
    setImages((current) => {
      const next = [...current]
      next[index] = file && previewUrl ? { file, previewUrl } : null
      return next
    })
  }

  const imageSlots = [
    {
      name: t("wordmarkTitle"),
      guide: t("wordmarkGuide"),
      example: "/images/almond-logo-black.png",
    },
    {
      name: t("iconTitle"),
      guide: t("iconGuide"),
      example: "/android-chrome-512x512.png",
    },
  ]

  return (
    <div className="pb-8">
      <header className="mb-8">
        <h1 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground mt-3 text-base leading-6">
          {t("intro")}
        </p>
      </header>

      <section aria-labelledby="contest-images-heading">
        <h2
          id="contest-images-heading"
          className="text-foreground text-xl font-bold"
        >
          {t("imagesLabel")}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t("imagesHint", {
            max: LOGO_CONTEST_MAX_IMAGES,
            size: LOGO_CONTEST_MAX_IMAGE_SIZE_MB,
          })}
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {images.map((image, index) => {
            const slot = imageSlots[index]
            return (
              <div key={index} className="min-w-0">
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="text-foreground text-base font-semibold">
                    {slot.name}{" "}
                    <span className="text-destructive" aria-hidden="true">
                      *
                    </span>
                  </h3>
                </div>
                <div className="relative">
                  <label
                    htmlFor={`logo-contest-image-${index}`}
                    className={`bg-muted/30 hover:bg-muted/50 flex h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-4 text-center transition-colors duration-200 focus-within:ring-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${errors[index === 0 ? "wordmark" : "icon"] ? "border-destructive hover:border-destructive focus-within:ring-destructive/20" : "border-border hover:border-primary focus-within:ring-primary/20"}`}
                  >
                    <input
                      id={`logo-contest-image-${index}`}
                      type="file"
                      accept={LOGO_CONTEST_ACCEPTED_IMAGE_TYPES}
                      disabled={isPending}
                      aria-label={t("selectImage", { name: slot.name })}
                      aria-required="true"
                      aria-invalid={!!errors[index === 0 ? "wordmark" : "icon"]}
                      aria-describedby={
                        errors[index === 0 ? "wordmark" : "icon"]
                          ? `logo-contest-image-${index}-error`
                          : undefined
                      }
                      className="sr-only"
                      onChange={(event) => {
                        if (event.target.files?.[0])
                          changeImage(index, event.target.files[0])
                        event.target.value = ""
                      }}
                    />
                    <span className="text-primary flex size-full flex-col items-center justify-center gap-2 overflow-hidden">
                      {image ? (
                        <img
                          src={image.previewUrl}
                          alt={t("previewAlt", { name: slot.name })}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <>
                          <span className="text-muted-foreground bg-background absolute top-3 left-3 rounded-md px-2 py-1 text-xs">
                            {t("exampleLabel")}
                          </span>
                          <img
                            src={slot.example}
                            alt={t("exampleAlt", { name: slot.name })}
                            className="max-h-24 max-w-full object-contain opacity-60"
                          />
                          <span className="bg-background text-primary absolute right-3 bottom-3 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm">
                            <ImagePlus className="size-4" aria-hidden="true" />
                            {t("selectImageAction")}
                          </span>
                        </>
                      )}
                    </span>
                    {image && (
                      <span className="bg-background text-foreground absolute right-3 bottom-3 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm">
                        {t("changeImageAction")}
                      </span>
                    )}
                  </label>
                  {image && (
                    <button
                      type="button"
                      onClick={() => changeImage(index, null)}
                      disabled={isPending}
                      aria-label={t("removeImage", { name: slot.name })}
                      className="bg-background text-muted-foreground hover:bg-muted absolute top-2 right-2 flex size-9 items-center justify-center rounded-full shadow-sm disabled:opacity-50"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="text-muted-foreground mt-2 text-sm leading-5">
                  {image ? image.file.name : slot.guide}
                </p>
                {errors[index === 0 ? "wordmark" : "icon"] && (
                  <p
                    id={`logo-contest-image-${index}-error`}
                    role="alert"
                    className="text-destructive mt-2 text-sm"
                  >
                    {errors[index === 0 ? "wordmark" : "icon"]}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section
        aria-labelledby="contest-info-heading"
        className="mt-12 space-y-6"
      >
        <h2
          id="contest-info-heading"
          className="text-foreground text-xl font-bold"
        >
          {t("workInfo")}
        </h2>
        <div>
          <div className="relative">
            <Input
              id="logo-contest-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setErrors((current) => ({ ...current, title: undefined }))
              }}
              placeholder=" "
              maxLength={LOGO_CONTEST_TITLE_MAX_LENGTH}
              aria-required="true"
              aria-invalid={!!errors.title}
              aria-describedby={
                errors.title ? "logo-contest-title-error" : undefined
              }
              disabled={isPending}
              className={`peer bg-background text-foreground h-16 rounded-xl border px-4 pt-5 pb-2 text-base transition-colors duration-200 placeholder:text-transparent focus-visible:ring-2 ${errors.title ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20" : "border-foreground/35 focus-visible:border-primary focus-visible:ring-primary/20"}`}
            />
            <Label
              htmlFor="logo-contest-title"
              className={`pointer-events-none absolute top-2 left-4 text-sm transition-all peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-sm ${errors.title ? "text-destructive" : "text-foreground/70"}`}
            >
              {t("nameLabel")}{" "}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </Label>
          </div>
          <p className="text-muted-foreground mt-1 text-right text-xs">
            {title.length}/{LOGO_CONTEST_TITLE_MAX_LENGTH}
          </p>
          {errors.title && (
            <p
              id="logo-contest-title-error"
              role="alert"
              className="text-destructive mt-2 text-sm"
            >
              {errors.title}
            </p>
          )}
        </div>

        <div>
          <div className="relative">
            <Textarea
              id="logo-contest-description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                setErrors((current) => ({ ...current, description: undefined }))
              }}
              placeholder=" "
              maxLength={LOGO_CONTEST_DESCRIPTION_MAX_LENGTH}
              aria-invalid={!!errors.description}
              aria-describedby={
                errors.description
                  ? "logo-contest-description-error"
                  : undefined
              }
              rows={4}
              disabled={isPending}
              className={`peer bg-background min-h-36 rounded-xl border px-4 pt-8 pb-4 text-base transition-colors duration-200 placeholder:text-transparent focus-visible:ring-2 ${errors.description ? "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20" : "border-foreground/35 focus-visible:border-primary focus-visible:ring-primary/20"}`}
            />
            <Label
              htmlFor="logo-contest-description"
              className={`pointer-events-none absolute top-2 left-4 text-sm transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:text-sm ${errors.description ? "text-destructive" : "text-foreground/70"}`}
            >
              {t("descriptionLabel")}
            </Label>
          </div>
          <p className="text-muted-foreground text-right text-xs">
            {description.length}/{LOGO_CONTEST_DESCRIPTION_MAX_LENGTH}
          </p>
          {errors.description && (
            <p
              id="logo-contest-description-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {errors.description}
            </p>
          )}
        </div>
      </section>

      <section className="bg-muted/50 mt-10 space-y-3 rounded-2xl p-5">
        <h3 className="text-foreground text-sm font-bold">
          {t("agreementTitle")}
        </h3>
        <p className="text-muted-foreground text-xs leading-6 whitespace-pre-line">
          {t("agreeTerms")}
        </p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="logo-contest-agree"
            checked={agreed}
            onCheckedChange={(checked) => {
              setAgreed(checked === true)
              setErrors((current) => ({ ...current, agreed: undefined }))
            }}
            aria-invalid={!!errors.agreed}
            aria-describedby={
              errors.agreed ? "logo-contest-agree-error" : undefined
            }
            disabled={isPending}
          />
          <Label
            htmlFor="logo-contest-agree"
            className="text-foreground text-sm leading-5 font-medium"
          >
            {t("agreeLabel")}{" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
        </div>
        {errors.agreed && (
          <p
            id="logo-contest-agree-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {errors.agreed}
          </p>
        )}
      </section>

      <div className="mt-8 flex flex-col-reverse gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/${countryCode}/logo-contest`)}
          disabled={isPending}
          className="text-muted-foreground hover:bg-muted h-12 border-0 bg-transparent shadow-none"
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 rounded-xl text-base font-bold"
        >
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </div>
  )
}
