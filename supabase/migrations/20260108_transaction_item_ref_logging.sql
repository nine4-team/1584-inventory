-- Track transaction.item_ids mutations and ensure deletes fall back to previous project transaction IDs.

create or replace function public.log_transaction_item_ref_event(
  p_account_id uuid,
  p_transaction_id text,
  p_item_id text,
  p_action text,
  p_context text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null or p_transaction_id is null or p_item_id is null then
    return;
  end if;

  begin
    insert into public.transaction_audit_logs (
      account_id,
      transaction_id,
      change_type,
      old_state,
      new_state,
      timestamp,
      created_at
    ) values (
      p_account_id,
      p_transaction_id,
      'updated',
      jsonb_build_object(
        'item_id', p_item_id,
        'action', p_action,
        'context', coalesce(p_context, 'transaction_item_ref')
      ),
      null,
      timezone('utc', now()),
      timezone('utc', now())
    );
  exception
    when others then
      -- Never block the main mutation path if audit logging fails.
      null;
  end;
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

  if found then
    perform public.log_transaction_item_ref_event(
      p_account_id,
      p_transaction_id,
      p_item_id,
      'added',
      'add_transaction_item_ref'
    );
  end if;
end;
$$;

create or replace function public.remove_deleted_item_ref(
  p_account_id uuid,
  p_transaction_id text,
  p_item_id text,
  p_previous_transaction_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_total numeric;
  formatted_amount text;
  is_canonical boolean;
  target_transaction_id text;
begin
  if p_account_id is null or p_item_id is null then
    return;
  end if;

  target_transaction_id := coalesce(p_transaction_id, p_previous_transaction_id);
  if target_transaction_id is null then
    return;
  end if;

  update public.transactions t
  set item_ids = array_remove(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id),
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = target_transaction_id
    and array_position(coalesce(t.item_ids, ARRAY[]::text[]), p_item_id) is not null;

  if found then
    perform public.log_transaction_item_ref_event(
      p_account_id,
      target_transaction_id,
      p_item_id,
      'removed',
      'remove_deleted_item_ref'
    );
  end if;

  is_canonical := target_transaction_id like 'INV_PURCHASE_%' or target_transaction_id like 'INV_SALE_%';
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
    and i.transaction_id = target_transaction_id;

  formatted_amount := to_char(coalesce(round(remaining_total, 2), 0), 'FM9999999999990.00');

  update public.transactions t
  set amount = formatted_amount,
      updated_at = timezone('utc', now())
  where t.account_id = p_account_id
    and t.transaction_id = target_transaction_id;
end;
$$;

create or replace function public.handle_item_delete_sync_transaction_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.remove_deleted_item_ref(
    OLD.account_id,
    OLD.transaction_id,
    OLD.item_id,
    OLD.previous_project_transaction_id
  );
  return OLD;
end;
$$;
