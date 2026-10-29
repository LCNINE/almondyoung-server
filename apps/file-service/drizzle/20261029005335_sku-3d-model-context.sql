-- Provision the authoritative context row during migrate, including existing environments.
INSERT INTO "file_contexts" (
  "id", "name", "description", "allow_public", "allow_private",
  "allowed_mime_types", "max_file_size", "path_prefix", "is_active"
) VALUES (
  'sku-3d-model', 'SKU 3D Model', 'SKU 실물 3D 모델(GLB), 검수 후 상품 상세에서 사용',
  true, false, '["model/gltf-binary"]'::jsonb, 20971520, 'inventory/sku-3d-models', true
)
ON CONFLICT ("id") DO UPDATE SET
  "allow_public" = EXCLUDED."allow_public",
  "allow_private" = EXCLUDED."allow_private",
  "allowed_mime_types" = EXCLUDED."allowed_mime_types",
  "max_file_size" = EXCLUDED."max_file_size",
  "path_prefix" = EXCLUDED."path_prefix",
  "is_active" = EXCLUDED."is_active",
  "updated_at" = now();
