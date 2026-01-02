-- Ensure realtime DELETE payloads from projects include all columns
-- so client caches can properly handle removed rows and avoid binding mismatches.
ALTER TABLE public.projects REPLICA IDENTITY FULL;
