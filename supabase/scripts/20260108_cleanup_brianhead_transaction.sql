-- Removes orphaned item references from the Brianhead Cabin transaction and logs the edits.
-- Transaction ID: 9689e160-6232-48da-9bc4-1693201012ea
-- Missing item IDs: I-1767139637044-6xqj, I-1767139637044-d2e0

begin;

do $$
declare
  v_transaction_id constant text := '9689e160-6232-48da-9bc4-1693201012ea';
  v_missing_item_ids constant text[] := array['I-1767139637044-6xqj', 'I-1767139637044-d2e0'];
  v_account_id uuid;
  v_item_id text;
begin
  select account_id
  into v_account_id
  from public.transactions
  where transaction_id = v_transaction_id
  limit 1;

  if v_account_id is null then
    raise exception 'Transaction % not found; aborting cleanup', v_transaction_id;
  end if;

  foreach v_item_id in array v_missing_item_ids loop
    update public.transactions t
    set item_ids = array_remove(coalesce(t.item_ids, ARRAY[]::text[]), v_item_id),
        updated_at = timezone('utc', now())
    where t.account_id = v_account_id
      and t.transaction_id = v_transaction_id
      and array_position(coalesce(t.item_ids, ARRAY[]::text[]), v_item_id) is not null;

    if found then
      insert into public.transaction_audit_logs (
        account_id,
        transaction_id,
        change_type,
        old_state,
        new_state,
        timestamp,
        created_at
      ) values (
        v_account_id,
        v_transaction_id,
        'updated',
        jsonb_build_object(
          'item_id', v_item_id,
          'action', 'removed',
          'context', 'manual_cleanup_brianhead_ghosts'
        ),
        null,
        timezone('utc', now()),
        timezone('utc', now())
      );
    end if;
  end loop;
end;
$$;

commit;
