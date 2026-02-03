// Shared ID helpers.
// In Ledger we have both:
// - `items.id`     (UUID, row primary key)
// - `items.item_id` (string business ID, often "I-...")

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function looksLikeUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

