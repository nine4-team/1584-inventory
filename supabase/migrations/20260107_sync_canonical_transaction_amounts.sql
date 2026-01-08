-- Canonical transaction amount synchronization + trigger coverage for item mutations.
-- Ensures INV_PURCHASE_* and INV_SALE_* transactions always mirror their item sums.

create or replace function public.sync_canonical_transaction_amount(
  p_account_id uuid,
  p_transaction_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  is_canonical boolean;
  total numeric;
  formatted_amount text;
begin
  if p_account_id is null or p_transaction_id is null then
    return;
  end if;

  is_canonical := p_transaction_id like 'INV_PURCHASE_%' or p_transaction_id like 'INV_SALE_%';
  if not is_canonical then
    return;
  end if;

  select coalesce(sum(
    coalesce(
      nullif(i.project_price, '')::numeric,
      nullif(i.purchase_price, '')::numeric,
      0
    )
  ), 0)
  into total
  from public.items i
  where i.account_id = p_account_id
    and i.transaction_id = p_transaction_id;

  formatted_amount := to_char(coalesce(round(total, 2), 0), 'FM9999999999990.00');

  update public.transactions t
  set amount = formatted_amount,
      sum_item_purchase_prices = formatted_amount::numeric,
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id;
end;
$$;

create or replace function public.add_transaction_item_ref(
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
  set item_ids = array_append(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id),
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id
    and array_position(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id) is null;
end;
$$;

create or replace function public.remove_deleted_item_ref(
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
  set item_ids = array_remove(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id),
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id
    and array_position(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id) is not null;

  perform public.sync_canonical_transaction_amount(p_account_id, p_transaction_id);
end;
$$;

create or replace function public.handle_item_insert_sync_transaction_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.add_transaction_item_ref(NEW.account_id, NEW.transaction_id, NEW.item_id);
  perform public.sync_canonical_transaction_amount(NEW.account_id, NEW.transaction_id);
  return NEW;
end;
$$;

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
  transaction_changed := (OLD.transaction_id is distinct from NEW.transaction_id);
  price_changed := (
    coalesce(OLD.project_price, '') is distinct from coalesce(NEW.project_price, '')
    or coalesce(OLD.purchase_price, '') is distinct from coalesce(NEW.purchase_price, '')
  );

  if transaction_changed then
    if NEW.transaction_id is not null then
      perform public.add_transaction_item_ref(NEW.account_id, NEW.transaction_id, NEW.item_id);
    end if;

    if OLD.transaction_id is not null then
      perform public.sync_canonical_transaction_amount(OLD.account_id, OLD.transaction_id);
    end if;

    if NEW.transaction_id is not null then
      perform public.sync_canonical_transaction_amount(NEW.account_id, NEW.transaction_id);
    end if;
  elsif price_changed and NEW.transaction_id is not null then
    perform public.sync_canonical_transaction_amount(NEW.account_id, NEW.transaction_id);
  end if;

  return NEW;
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

drop trigger if exists trg_items_after_insert_sync_item_refs on public.items;
drop trigger if exists trg_items_after_update_sync_item_refs on public.items;
drop trigger if exists trg_items_after_delete_sync_item_ids on public.items;

create trigger trg_items_after_insert_sync_item_refs
after insert on public.items
for each row
execute function public.handle_item_insert_sync_transaction_refs();

create trigger trg_items_after_update_sync_item_refs
after update on public.items
for each row
when (
  OLD.transaction_id is distinct from NEW.transaction_id
  or coalesce(OLD.project_price, '') is distinct from coalesce(NEW.project_price, '')
  or coalesce(OLD.purchase_price, '') is distinct from coalesce(NEW.purchase_price, '')
)
execute function public.handle_item_update_sync_transaction_refs();

create trigger trg_items_after_delete_sync_item_ids
after delete on public.items
for each row
execute function public.handle_item_delete_sync_transaction_ids();
