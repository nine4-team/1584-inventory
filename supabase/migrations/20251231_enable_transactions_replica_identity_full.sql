-- Ensure realtime DELETE payloads include transaction_id and other columns
-- so the client can immediately drop removed rows without issuing refetches.
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
