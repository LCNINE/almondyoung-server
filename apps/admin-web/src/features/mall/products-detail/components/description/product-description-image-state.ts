type ProductDescriptionImageStateInput = {
  fileId: string | null;
  failedFileId: string | null;
};

type ProductDescriptionImagePlaceholderInput = ProductDescriptionImageStateInput & {
  error?: string | null;
};

export function isProductDescriptionImageBroken({
  fileId,
  failedFileId,
}: ProductDescriptionImageStateInput): boolean {
  return Boolean(fileId && failedFileId === fileId);
}

export function shouldShowProductDescriptionImagePlaceholder({
  fileId,
  error,
  failedFileId,
}: ProductDescriptionImagePlaceholderInput): boolean {
  return !fileId || Boolean(error) || isProductDescriptionImageBroken({ fileId, failedFileId });
}
