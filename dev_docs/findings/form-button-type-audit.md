## Buttons Inside Forms Missing `type`

When a `button` is inside a `form` and has no `type`, the browser treats it as `type="submit"`. Any non-submit action can accidentally trigger form submission (like the image upload buttons you hit).

### Findings

- `src/pages/AddItem.tsx`
  - **Buttons:** "Add Images" (both the header button and the empty-state button)
  - **Why this is a problem:** Clicking these buttons submits the form once it has a valid image, causing an unintended save.
  - **Recommended fix:** Add `type="button"` to both buttons.

- `src/pages/AddBusinessInventoryItem.tsx`
  - **Buttons:** "Add Images" (both the header button and the empty-state button)
  - **Why this is a problem:** Same implicit submit behavior as `AddItem`.
  - **Recommended fix:** Add `type="button"` to both buttons.

- `src/pages/EditTransaction.tsx`
  - **Buttons:** "Cancel" (desktop action bar and sticky mobile action bar)
  - **Why this is a problem:** Cancel actions are inside the form and currently submit it.
  - **Recommended fix:** Add `type="button"` to both cancel buttons.

- `src/pages/EditBusinessInventoryTransaction.tsx`
  - **Buttons:** "Cancel" (desktop action bar and sticky mobile action bar)
  - **Why this is a problem:** Cancel actions are inside the form and currently submit it.
  - **Recommended fix:** Add `type="button"` to both cancel buttons.

### General Rule

For any `button` inside a `form`:
- Use `type="submit"` for the primary submit action.
- Use `type="button"` for all other actions (cancel, add images, open modal, toggle UI, etc.).
