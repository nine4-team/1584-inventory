-- Storage Policies for Project Images Bucket
-- Note: The 'project-images' bucket must be created manually in Supabase Dashboard first
-- This migration adds RLS policies for the project-images bucket

-- ============================================================================
-- Project Images Bucket Policies
-- ============================================================================

-- Authenticated users can read project images
CREATE POLICY "Authenticated users can read project images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'project-images');

-- Authenticated users can upload project images
CREATE POLICY "Authenticated users can upload project images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'project-images');

-- Authenticated users can update project images
CREATE POLICY "Authenticated users can update project images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'project-images')
WITH CHECK (bucket_id = 'project-images');

-- Authenticated users can delete project images
CREATE POLICY "Authenticated users can delete project images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'project-images');
