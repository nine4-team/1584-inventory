create extension if not exists btree_gist;

alter table public.item_lineage_edges
  add column if not exists movement_kind text null,
  add column if not exists source text not null default 'app';

create index if not exists idx_item_lineage_edges_account_from_kind_created
  on public.item_lineage_edges(account_id, from_transaction_id, movement_kind, created_at);

create index if not exists idx_item_lineage_edges_account_from_created
  on public.item_lineage_edges(account_id, from_transaction_id, created_at);

create index if not exists idx_item_lineage_edges_account_to_created
  on public.item_lineage_edges(account_id, to_transaction_id, created_at);

create or replace function public.append_item_lineage_edge_if_missing(
  p_account_id uuid,
  p_item_id text,
  p_from_transaction_id text,
  p_to_transaction_id text,
  p_note text default null,
  p_movement_kind text default null,
  p_source text default 'db_trigger'
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null or p_item_id is null then
    return;
  end if;

  -- Deduplicate: avoid inserting identical edges in a short window.
  if exists (
    select 1
    from public.item_lineage_edges le
    where le.account_id = p_account_id
      and le.item_id = p_item_id
      and le.from_transaction_id is not distinct from p_from_transaction_id
      and le.to_transaction_id is not distinct from p_to_transaction_id
      and le.movement_kind is not distinct from p_movement_kind
      and le.source = coalesce(p_source, 'db_trigger')
      and le.created_at >= (timezone('utc', now()) - interval '5 seconds')
  ) then
    return;
  end if;

  insert into public.item_lineage_edges (
    account_id,
    item_id,
    from_transaction_id,
    to_transaction_id,
    movement_kind,
    source,
    created_by,
    note,
    created_at
  ) values (
    p_account_id,
    p_item_id,
    p_from_transaction_id,
    p_to_transaction_id,
    p_movement_kind,
    coalesce(p_source, 'db_trigger'),
    null,
    coalesce(p_note, 'db_trigger_item_transaction_change'),
    timezone('utc', now())
  );
exception
  when others then
    -- Never block the main mutation path if lineage insert fails.
    null;
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
  transaction_changed := (old.transaction_id is distinct from new.transaction_id);
  price_changed := (
    coalesce(old.project_price, '') is distinct from coalesce(new.project_price, '')
    or coalesce(old.purchase_price, '') is distinct from coalesce(new.purchase_price, '')
  );

  if transaction_changed then
    -- Record association history for any transaction change (including to/from inventory).
    perform public.append_item_lineage_edge_if_missing(
      new.account_id,
      new.item_id,
      old.transaction_id,
      new.transaction_id,
      'db_trigger_item_transaction_change',
      'association',
      'db_trigger'
    );

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
