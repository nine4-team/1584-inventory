-- Storage Policies for Space Images Bucket
-- Note: The 'space-images' bucket must be created manually in Supabase Dashboard first
-- This migration adds RLS policies for the space-images bucket

-- ============================================================================
-- Space Images Bucket Policies
-- ============================================================================

-- Authenticated users can read space images
CREATE POLICY "Authenticated users can read space images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'space-images');

-- Authenticated users can upload space images
CREATE POLICY "Authenticated users can upload space images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'space-images');

-- Authenticated users can update space images
CREATE POLICY "Authenticated users can update space images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'space-images')
WITH CHECK (bucket_id = 'space-images');

-- Authenticated users can delete space images
CREATE POLICY "Authenticated users can delete space images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'space-images');
