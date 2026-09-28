import {
  LOGO_CONTEST_DESCRIPTION_MAX_LENGTH,
  LOGO_CONTEST_TITLE_MAX_LENGTH,
} from "../../../lib/types/ui/logo-contest"

export type FieldErrors = Partial<
  Record<"title" | "description" | "wordmark" | "icon" | "agreed", string>
>

export function validateEntry(
  values: {
    title: string
    description: string
    hasWordmark: boolean
    hasIcon: boolean
    agreed: boolean
  },
  messages: {
    nameRequired: string
    nameTooLong: string
    descriptionTooLong: string
    wordmarkRequired: string
    iconRequired: string
    agreeRequired: string
  }
): FieldErrors {
  const errors: FieldErrors = {}
  if (!values.title.trim()) errors.title = messages.nameRequired
  else if (values.title.trim().length > LOGO_CONTEST_TITLE_MAX_LENGTH)
    errors.title = messages.nameTooLong
  if (values.description.length > LOGO_CONTEST_DESCRIPTION_MAX_LENGTH)
    errors.description = messages.descriptionTooLong
  if (!values.hasWordmark) errors.wordmark = messages.wordmarkRequired
  if (!values.hasIcon) errors.icon = messages.iconRequired
  if (!values.agreed) errors.agreed = messages.agreeRequired
  return errors
}
