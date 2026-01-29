## Flow: Lineage edges and pointers

## What lineage is for
Lineage is the append-only history that lets users and the system answer:

- “Where did this item go?”
- “Which transaction did this item come from / move to?”
- “What was the last known transaction context for this item?”

This spec treats lineage as **required** for cross-scope operations and canonical inventory mechanics.

## Data model (conceptual)

### Edges (append-only)
Each edge represents a move:
- `fromTransactionId` (nullable; null means “from inventory”)
- `toTransactionId` (nullable; null means “to inventory”)
- `createdAt`
- `createdBy`
- `note` (optional)

Parity evidence:
- `ItemLineageEdge` shape + conversion: `src/services/lineageService.ts`

### Pointers (on item)
Maintain pointers so most screens do not need to reconstruct full history:
- `latestTransactionId` (nullable)
- optionally `originTransactionId` (set once)

Parity evidence:
- Pointer maintenance: `updateItemLineagePointers` in `src/services/lineageService.ts`.

## Behavior contract

### 1) Append lineage edge on every cross-scope move (best-effort)
Operations that must append lineage edges:
- Project → Business Inventory (move correction)
- Project → Business Inventory (canonical deallocation)
- Business Inventory → Project allocation
- Project → Project sell (both sub-steps)

Implementation note (Firebase):
- Prefer appending lineage as part of the server-owned invariant transaction for the operation.

Parity evidence (web calls):
- `moveItemToBusinessInventory` (best-effort lineage) in `src/services/inventoryService.ts`
- `deallocationService.handleInventoryDesignation` (best-effort lineage) in `src/services/inventoryService.ts`
- Allocation helpers call lineage methods in `src/services/inventoryService.ts`

### 2) Duplicate suppression / idempotency
Rapid repeated lineage writes should not create duplicates.

Parity evidence:
- `appendItemLineageEdge` duplicate suppression window (5 seconds) in `src/services/lineageService.ts`.

### 3) Update pointers on write
After appending an edge, update `latestTransactionId` to match `toTransactionId`.

Parity evidence:
- `updateItemLineagePointers` in `src/services/lineageService.ts` and usage in `src/services/inventoryService.ts`.

### 4) UI consumption
Lineage history can be fetched for an item detail view.

Parity evidence:
- `getItemLineageHistory` in `src/services/lineageService.ts`.

## Offline behavior
Parity in the current web app:
- When offline, lineage history fetch returns empty.

Parity evidence:
- `getItemLineageHistory` checks `isNetworkOnline()` in `src/services/lineageService.ts`.

Firebase migration requirement:
- Lineage edges should be available offline via local DB + delta sync once the feature is implemented (so Item Detail can show history even offline).  
  **Intentional delta**: mobile local DB becomes the source of truth for lineage edges as well, consistent with the overall architecture.
