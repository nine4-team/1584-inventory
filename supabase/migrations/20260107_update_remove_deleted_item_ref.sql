-- Scope `remove_deleted_item_ref` to canonical inventory transactions only.
-- Non-canonical transactions still lose the deleted item reference but keep their manual amount.
-- Canonical transactions now fall back to purchase_price before market_value when recomputing totals.

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
  is_canonical boolean;
begin
  if p_account_id is null or p_transaction_id is null or p_item_id is null then
    return;
  end if;

  -- Always drop the dangling item reference
  update public.transactions t
  set item_ids = array_remove(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id),
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id
    and array_position(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id) is not null;

  -- Only canonical inventory transactions should mirror amounts to item sums.
  is_canonical := p_transaction_id like 'INV_PURCHASE_%' or p_transaction_id like 'INV_SALE_%';
  if not is_canonical then
    return;
  end if;

  select coalesce(sum(
    coalesce(
      nullif(i.project_price, '')::numeric,
      nullif(i.purchase_price, '')::numeric,
      nullif(i.market_value, '')::numeric,
      0
    )
  ), 0)
  into remaining_total
  from public.items i
  where i.account_id = p_account_id
    and i.transaction_id = p_transaction_id;

  formatted_amount := to_char(coalesce(round(remaining_total, 2), 0), 'FM9999999999990.00');

  update public.transactions t
  set amount = formatted_amount,
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = p_transaction_id;
end;
$$;
