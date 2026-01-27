# Data (`20_data/`)

Data model + schema docs that features should reference instead of reinventing.

Put docs here like:
- `firebase_data_model.md`
- `local_sqlite_schema.md`
- (future) `data_contracts.md` (data transfer objects / sync payload shapes)

## Naming conventions (canonical)

These conventions keep the Firebase plan aligned with the **current app** (`src/types`) and avoid drift.

### Firestore documents (remote)

- **Field casing**: `camelCase`
- **IDs**: use document id as canonical `id`; also store foreign keys as `accountId`, `projectId`, etc. (camelCase)
- **Timestamps**: `createdAt`, `updatedAt`, `deletedAt` (Firestore `Timestamp`)
- **Sync fields (remote, required on sync’d entities)**:
  - `updatedAt`, `deletedAt`, `version`, `updatedBy`, `lastMutationId`, `schemaVersion`
- **Enums/roles**: match app enums (e.g. account membership role is `"admin" | "user"`, system owner is `"owner"`)

### SQLite tables (local)

- **Column casing**: `snake_case`
- **Remote-mirrored sync fields**: keep `*_server` suffix when storing Firestore timestamps as integers:
  - `updated_at_server`, `deleted_at_server`, `version`, `updated_by`, `last_mutation_id`, `schema_version`
- **Local-only bookkeeping**: `local_*` prefix (e.g. `local_pending`, `local_updated_at`)

