with local(item_id, label, project_id, account_id) as (
  values
    ('ecc33a2b-6c32-422a-b358-ca022c8fc986', 'Natural cut large wood bowl', null, '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94'),
    ('ed1eba4b-4d64-4c9d-980e-faf296ff3f36', 'Tan bubble-textured lumbar pillow', null, '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94'),
    ('f0b0cb16-bb82-4e2a-abcb-7a3d02afea54', 'f0b0cb16-bb82-4e2a-abcb-7a3d02afea54', null, '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94'),
    ('f9c0e07e-5385-447c-8cf9-dcd4a0f49105', 'Broccoli-style greenery in black rectangle long pots', null, '1dd4fd75-8eea-4f7a-98e7-bf45b987ae94')
)
select
  local.item_id as "itemId",
  local.label as "label",
  local.project_id as "projectId",
  local.account_id as "accountId"
from local
where not exists (
  select 1 from public.items i
  where i.account_id = local.account_id::uuid
    and i.item_id = local.item_id
)
order by local.item_id;
