-- Ensure transaction.item_ids arrays drop references when an item row is deleted.
-- This keeps TransactionDetail from fetching phantom item IDs while still allowing
-- historical IDs to remain when items are moved between transactions.

create or replace function public.remove_deleted_item_ref(
  p_account_id uuid,
  p_transaction_id text,
  p_item_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_total numeric;
  formatted_amount text;
begin
  if p_account_id is null or p_transaction_id is null or p_item_id is null then
    return;
  end if;

  select coalesce(sum(
    coalesce(nullif(i.project_price, '')::numeric, nullif(i.market_value, '')::numeric, 0)
  ), 0)
  into remaining_total
  from public.items i
  where i.account_id = p_account_id
    and i.transaction_id = p_transaction_id;

  formatted_amount := to_char(coalesce(round(remaining_total, 2), 0), 'FM9999999999990.00');

  update public.transactions t
  set item_ids = array_remove(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id),
      amount = formatted_amount,
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id
    and array_position(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id) is not null;
end;
$$;

create or replace function public.handle_item_delete_sync_transaction_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.remove_deleted_item_ref(OLD.account_id, OLD.transaction_id, OLD.item_id);
  return OLD;
end;
$$;

drop trigger if exists trg_items_after_delete_sync_item_ids on public.items;

create trigger trg_items_after_delete_sync_item_ids
after delete on public.items
for each row
execute function public.handle_item_delete_sync_transaction_ids();

do $$
declare
  rec record;
begin
  for rec in
    with expanded as (
      select
        t.account_id,
        t.transaction_id,
        unnest(t.item_ids) as item_id
      from public.transactions t
      where t.item_ids is not null
    )
    select e.account_id, e.transaction_id, e.item_id
    from expanded e
    where not exists (
      select 1
      from public.items i
      where i.account_id = e.account_id
        and i.item_id = e.item_id
    )
  loop
    perform public.remove_deleted_item_ref(rec.account_id, rec.transaction_id, rec.item_id);
  end loop;
end;
$$;
