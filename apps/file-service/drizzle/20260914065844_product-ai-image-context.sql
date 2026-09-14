INSERT INTO "file_contexts" (
  "id", "name", "description", "allow_public", "allow_private",
  "allowed_mime_types", "max_file_size", "path_prefix", "is_active"
) VALUES (
  'product-ai-image', 'AI Chat Image', 'AI 대화 비공개 첨부 이미지', false, true,
  '["image/jpeg","image/png","image/webp"]'::jsonb, 5242880, 'ai-chat/images', true
) ON CONFLICT ("id") DO NOTHING;
