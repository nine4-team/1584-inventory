-- Reassert realtime configuration for projects table.
-- Some environments were reset from snapshots taken before
-- 20250102_enable_projects_replica_identity_full.sql ran, which
-- causes realtime subscriptions that filter on account_id to fail.
-- This migration makes sure replica identity/full-row streaming is
-- enabled again and that the projects table stays in the publication.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'projects'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER TABLE public.projects REPLICA IDENTITY FULL';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'projects'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.projects';
    END IF;
  END IF;
END $$;
