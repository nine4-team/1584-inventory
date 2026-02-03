-- Safely repair existing bad data in transactions.item_ids.
--
-- Goal: remove "ghost" item IDs that are no longer attached to the transaction AND are not
-- backed by lineage (moved out). This fixes cases where audit/completeness can show "Complete"
-- while the transaction has zero real items.
--
-- Definition used here:
-- - "In transaction": items.transaction_id = transactions.transaction_id
-- - "Moved out (kept for history)": item_lineage_edges.from_transaction_id = transactions.transaction_id
--
-- Corrective moves that should not preserve history will typically have no lineage edge,
-- so their stale item_ids entries will be removed.

with desired as (
  select
    t.account_id,
    t.transaction_id,
    (
      select array_agg(distinct x order by x)
      from (
        select i.item_id as x
        from public.items i
        where i.account_id = t.account_id
          and i.transaction_id = t.transaction_id

        union

        select le.item_id as x
        from public.item_lineage_edges le
        where le.account_id = t.account_id
          and le.from_transaction_id = t.transaction_id
      ) s
    ) as desired_item_ids
  from public.transactions t
)
update public.transactions t
set item_ids = coalesce(d.desired_item_ids, array[]::text[]),
    updated_at = timezone('utc', now())
from desired d
where t.account_id = d.account_id
  and t.transaction_id = d.transaction_id
  and coalesce(t.item_ids, array[]::text[]) is distinct from coalesce(d.desired_item_ids, array[]::text[]);

