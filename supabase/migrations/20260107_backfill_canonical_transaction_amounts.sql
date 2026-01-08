-- Backfill canonical transaction amounts + sum_item_purchase_prices so every INV_* row
-- reflects the authoritative total of its child items.

with canonical_totals as (
  select
    t.account_id,
    t.transaction_id,
    coalesce(round(s.item_total, 2), 0)::numeric(16, 2) as amount_numeric,
    to_char(coalesce(round(s.item_total, 2), 0), 'FM9999999999990.00') as amount_text
  from public.transactions t
  left join (
    select
      account_id,
      transaction_id,
      sum(
        coalesce(
          nullif(project_price, '')::numeric,
          nullif(purchase_price, '')::numeric,
          0
        )
      ) as item_total
    from public.items
    where transaction_id like 'INV_%'
    group by account_id, transaction_id
  ) s
    on s.account_id = t.account_id
   and s.transaction_id = t.transaction_id
  where t.transaction_id like 'INV_%'
)
update public.transactions t
set amount = c.amount_text,
    sum_item_purchase_prices = c.amount_numeric,
    updated_at = timezone('utc', now())
from canonical_totals c
where t.account_id = c.account_id
  and t.transaction_id = c.transaction_id;
