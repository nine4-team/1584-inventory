-- Backfill script to restore moved items to transaction item_ids arrays
-- This fixes the historical completeness issue where items were removed when moved

-- Add back all items that moved out of transactions (have from_transaction_id set)
-- but are no longer in their source transaction's item_ids array

DO $$
DECLARE
    edge_record RECORD;
    current_item_ids TEXT[];
    updated_item_ids TEXT[];
BEGIN
    -- Iterate through all lineage edges where items moved FROM a transaction
    FOR edge_record IN
        SELECT
            le.account_id,
            le.item_id,
            le.from_transaction_id,
            le.to_transaction_id
        FROM public.item_lineage_edges le
        WHERE le.from_transaction_id IS NOT NULL
        AND le.to_transaction_id IS NOT NULL
    LOOP
        -- Check if the item is still in the source transaction's item_ids
        SELECT item_ids INTO current_item_ids
        FROM public.transactions
        WHERE account_id = edge_record.account_id
        AND transaction_id = edge_record.from_transaction_id;

        -- If item_ids is not an array or is null, initialize it
        IF current_item_ids IS NULL THEN
            current_item_ids := '{}';
        END IF;

        -- If the item is not in the array, add it back
        IF NOT (edge_record.item_id = ANY(current_item_ids)) THEN
            updated_item_ids := array_append(current_item_ids, edge_record.item_id);

            -- Update the transaction with the restored item
            UPDATE public.transactions
            SET
                item_ids = updated_item_ids,
                updated_at = NOW()
            WHERE account_id = edge_record.account_id
            AND transaction_id = edge_record.from_transaction_id;

            RAISE NOTICE 'Restored item % to transaction % (moved to %)',
                edge_record.item_id, edge_record.from_transaction_id, edge_record.to_transaction_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Backfill complete: moved items restored to transaction item_ids arrays';
END $$;