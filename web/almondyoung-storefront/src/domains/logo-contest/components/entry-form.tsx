"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ImageUpload,
  type ImagePreview,
} from "@/domains/cs/components/inquiry/image-upload"
import { uploadFile } from "@/lib/api/file/upload"
import { createLogoContestEntry } from "@/lib/api/ugc/logo-contest"
import {
  LOGO_CONTEST_DESCRIPTION_MAX_LENGTH,
  LOGO_CONTEST_MAX_IMAGES,
  LOGO_CONTEST_MIN_IMAGES,
  LOGO_CONTEST_MAX_IMAGE_SIZE_MB,
  LOGO_CONTEST_TITLE_MAX_LENGTH,
} from "@/lib/types/ui/logo-contest"
import { useUser } from "@/contexts/user-context"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

const LOGO_CONTEST_IMAGE_CONTEXT_ID = "logo-contest-image"

interface EntryFormProps {
  onClose: () => void
}

export function EntryForm({ onClose }: EntryFormProps) {
  const t = useTranslations("logoContest.form")
  const router = useRouter()
  const { user } = useUser()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<ImagePreview[]>([])
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const validate = (): string | null => {
    if (title.trim().length === 0) return t("nameRequired")
    if (title.trim().length > LOGO_CONTEST_TITLE_MAX_LENGTH) {
      return t("nameTooLong", { max: LOGO_CONTEST_TITLE_MAX_LENGTH })
    }
    if (description.length > LOGO_CONTEST_DESCRIPTION_MAX_LENGTH) {
      return t("descriptionTooLong", {
        max: LOGO_CONTEST_DESCRIPTION_MAX_LENGTH,
      })
    }
    if (images.length < LOGO_CONTEST_MIN_IMAGES) return t("imagesRequired")
    if (!agreed) return t("agreeRequired")
    return null
  }

  const handleSubmit = () => {
    const invalid = validate()
    setError(invalid)
    if (invalid) return

    startTransition(async () => {
      try {
        const uploaded = await Promise.all(
          images.map((image) => {
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

        images.forEach((image) => URL.revokeObjectURL(image.previewUrl))
        toast.success(t("done"))
        onClose()
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

  return (
    <Card className="border-border rounded-xl">
      <CardContent className="space-y-6 p-6">
        <div className="space-y-2">
          <Label htmlFor="logo-contest-title">{t("nameLabel")}</Label>
          <Input
            id="logo-contest-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={LOGO_CONTEST_TITLE_MAX_LENGTH}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="logo-contest-description">
            {t("descriptionLabel")}
          </Label>
          <Textarea
            id="logo-contest-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t("descriptionPlaceholder")}
            maxLength={LOGO_CONTEST_DESCRIPTION_MAX_LENGTH}
            rows={4}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("imagesLabel")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("imagesHint", {
              max: LOGO_CONTEST_MAX_IMAGES,
              size: LOGO_CONTEST_MAX_IMAGE_SIZE_MB,
            })}
          </p>
          <ol className="text-muted-foreground space-y-1 text-sm">
            <li><strong className="text-foreground">1.</strong> {t("wordmarkGuide")}</li>
            <li><strong className="text-foreground">2.</strong> {t("iconGuide")}</li>
            <li><strong className="text-foreground">3.</strong> {t("optionalGuide")}</li>
          </ol>
          <ImageUpload
            images={images}
            onImagesChange={setImages}
            disabled={isPending}
          />
        </div>

        <div className="bg-muted space-y-3 rounded-lg p-4">
          <p className="text-muted-foreground text-xs leading-5">
            {t("agreeTerms")}
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="logo-contest-agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              disabled={isPending}
            />
            <Label
              htmlFor="logo-contest-agree"
              className="text-foreground text-sm leading-5 font-medium"
            >
              {t("agreeLabel")}
            </Label>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isPending}
            className="h-[52px] flex-1 rounded-xl"
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="bg-primary h-[52px] flex-1 rounded-xl text-base font-bold text-white"
          >
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
