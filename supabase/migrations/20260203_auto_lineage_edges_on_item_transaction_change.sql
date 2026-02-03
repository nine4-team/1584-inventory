-- NOTE (2026-02-03):
-- We no longer auto-create lineage edges for every items.transaction_id change.
-- "Move" can be a corrective operation (fixing a mistake), and we don't want to
-- permanently store that mistake as history.
--
-- This migration is superseded by:
-- - 20260203_fix_item_ref_drift_remove_old_ref_on_move.sql
-- - 20260203_backfill_rebuild_transaction_item_ids_from_truth.sql
--
-- The objects defined below are left in place for historical compatibility, but are
-- not used by the active trigger function after the superseding migration runs.

create or replace function public.append_item_lineage_edge_if_missing(
  p_account_id uuid,
  p_item_id text,
  p_from_transaction_id text,
  p_to_transaction_id text,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null or p_item_id is null then
    return;
  end if;

  -- Deduplicate: do not insert identical edges repeatedly.
  if exists (
    select 1
    from public.item_lineage_edges le
    where le.account_id = p_account_id
      and le.item_id = p_item_id
      and le.from_transaction_id is not distinct from p_from_transaction_id
      and le.to_transaction_id is not distinct from p_to_transaction_id
  ) then
    return;
  end if;

  insert into public.item_lineage_edges (
    account_id,
    item_id,
    from_transaction_id,
    to_transaction_id,
    created_by,
    note,
    created_at
  ) values (
    p_account_id,
    p_item_id,
    p_from_transaction_id,
    p_to_transaction_id,
    null,
    coalesce(p_note, 'db_trigger_auto_lineage'),
    timezone('utc', now())
  );
exception
  when others then
    -- Never block the main mutation path if lineage insert fails.
    null;
end;
$$;

-- Update the existing trigger function to also write lineage edges on moves.
create or replace function public.handle_item_update_sync_transaction_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  transaction_changed boolean;
  price_changed boolean;
begin
  transaction_changed := (old.transaction_id is distinct from new.transaction_id);
  price_changed := (
    coalesce(old.project_price, '') is distinct from coalesce(new.project_price, '')
    or coalesce(old.purchase_price, '') is distinct from coalesce(new.purchase_price, '')
  );

  if transaction_changed then
    -- Record lineage for any transaction change (including to/from inventory).
    perform public.append_item_lineage_edge_if_missing(
      new.account_id,
      new.item_id,
      old.transaction_id,
      new.transaction_id,
      'db_trigger_item_transaction_change'
    );

    if new.transaction_id is not null then
      perform public.add_transaction_item_ref(new.account_id, new.transaction_id, new.item_id);
    end if;

    if old.transaction_id is not null then
      perform public.sync_canonical_transaction_amount(old.account_id, old.transaction_id);
    end if;

    if new.transaction_id is not null then
      perform public.sync_canonical_transaction_amount(new.account_id, new.transaction_id);
    end if;
  elsif price_changed and new.transaction_id is not null then
    perform public.sync_canonical_transaction_amount(new.account_id, new.transaction_id);
  end if;

  return new;
end;
$$;

