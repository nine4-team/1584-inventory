-- Add main_image_url column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS main_image_url TEXT;

-- Add comment to document the field
COMMENT ON COLUMN projects.main_image_url IS 'URL of the main/primary image for the project';
