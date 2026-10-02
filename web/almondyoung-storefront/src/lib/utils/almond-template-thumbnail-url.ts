import { requireBackendBaseUrl } from "@/lib/config/backend"

export const almondTemplateThumbnailUrl = (id: string, version?: string) => {
  const url = `${requireBackendBaseUrl("ugc")}/almond-templates/${encodeURIComponent(id)}/thumbnail.svg`
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}
