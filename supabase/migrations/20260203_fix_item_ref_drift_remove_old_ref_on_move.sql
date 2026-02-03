-- Fix item ref drift safely:
-- When items.transaction_id changes, remove the item from the OLD transaction's item_ids,
-- and add it to the NEW transaction's item_ids.
--
-- IMPORTANT: This intentionally does NOT create lineage edges. Corrective "move" operations
-- should not necessarily record history. App-level flows that represent true movements
-- (allocations, sales, returns) should create lineage explicitly.

create or replace function public.remove_transaction_item_ref(
  p_account_id uuid,
  p_transaction_id text,
  p_item_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null or p_transaction_id is null or p_item_id is null then
    return;
  end if;

  update public.transactions t
  set item_ids = array_remove(coalesce(t.item_ids, array[]::text[]), p_item_id),
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id
    and array_position(coalesce(t.item_ids, array[]::text[]), p_item_id) is not null;

  if found then
    begin
      -- Best-effort audit logging; never block the main mutation path.
      perform public.log_transaction_item_ref_event(
        p_account_id,
        p_transaction_id,
        p_item_id,
        'removed',
        'remove_transaction_item_ref'
      );
    exception
      when others then
        null;
    end;
  end if;
end;
$$;

-- Override the existing trigger function (defined in 20260107_sync_canonical_transaction_amounts.sql)
-- to remove OLD refs on transaction_id changes.
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
    -- Remove "sticky" old reference to prevent drift/ghost completeness.
    if old.transaction_id is not null then
      perform public.remove_transaction_item_ref(old.account_id, old.transaction_id, old.item_id);
    end if;

    -- Add to the new transaction's refs (if any)
    if new.transaction_id is not null then
      perform public.add_transaction_item_ref(new.account_id, new.transaction_id, new.item_id);
    end if;

    -- Re-sync canonical amounts on both sides.
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

