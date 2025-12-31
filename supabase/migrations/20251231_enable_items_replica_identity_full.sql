-- Ensure realtime DELETE payloads from items include item_id and other columns
-- so client caches can drop removed rows immediately.
ALTER TABLE public.items REPLICA IDENTITY FULL;
