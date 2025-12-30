# Invitation Link System Implementation Plan

## Overview

This document outlines the plan to complete the invitation link system implementation, addressing three key areas:
1. Display and manage invite links in AccountManagement (owner-only)
2. Add email/password signup option alongside Google OAuth
3. Show pending invitations per account in AccountManagement

## Current State

### What's Working ✅
- First app user correctly gets `owner` role
- First account user correctly gets `admin` role (not owner)
- Account creation is owner-only via `AccountManagement` component
- Invitation tokens are generated and stored in database
- Invite links work with Google OAuth flow
- UserManagement shows pending invitations (account-scoped, for account admins)

### What's Missing ❌
1. **AccountManagement doesn't capture/display invite links** - Creates invitation but doesn't show the returned link
2. **No email/password signup** - InviteAccept page only supports Google OAuth
3. **App owner can't see account invite links** - No UI to view/manage invitations for accounts they create

---

## Implementation Plan

### Phase 1: Fix AccountManagement Invite Link Display

**Goal**: When app owner creates an account, capture and display the invitation link with copy functionality.

**Changes Required**:

1. **Update `AccountManagement.createAccount()` function**
   - Capture the returned invitation link from `createUserInvitation()`
   - Store it in component state
   - Display it in the success message or a dedicated section

2. **Add UI Components**
   - Display invitation link in a copyable format
   - Add copy-to-clipboard button with visual feedback
   - Show invitation details (email, role, expiration date)

3. **Update Success Message**
   - Change from "Invitation sent to {email}" to "Account created. Invitation link: {link}"
   - Or show link in a modal/dedicated section below the form

**Files to Modify**:
- `src/components/auth/AccountManagement.tsx`

**Acceptance Criteria**:
- [ ] App owner sees invitation link immediately after creating account
- [ ] Link can be copied to clipboard with one click
- [ ] Visual feedback confirms successful copy
- [ ] Link is displayed in a user-friendly format

---

### Phase 2: Add Email/Password Signup to InviteAccept Page

**Goal**: Allow users to sign up with email/password in addition to Google OAuth when accepting invitations.

**Changes Required**:

1. **Update `InviteAccept.tsx` Component**
   - Add email/password signup form alongside Google OAuth button
   - Add toggle/tabs to switch between signup methods
   - Handle form validation (email format, password strength)
   - Show password requirements

2. **Add Supabase Email/Password Signup**
   - Use `supabase.auth.signUp()` for email/password registration
   - Handle email confirmation flow
   - Store invitation token in localStorage before redirect
   - Handle signup errors (email already exists, weak password, etc.)

3. **Update Auth Flow**
   - Ensure `AuthCallback` handles both OAuth and email/password signups
   - Verify invitation token is processed correctly for both flows
   - Handle email verification requirement (may need to redirect to verification page)

4. **Add Email Verification Handling**
   - Check if Supabase requires email confirmation
   - If yes, show verification message after signup
   - Store invitation token to process after email verification
   - Create verification callback handler if needed

**Files to Modify**:
- `src/pages/InviteAccept.tsx`
- `src/services/supabase.ts` (add email/password signup function if needed)
- `src/pages/AuthCallback.tsx` (may need updates for email verification flow)

**New Functions Needed**:
- `signUpWithEmailPassword(email: string, password: string): Promise<void>`
- Email verification check/handler

**Acceptance Criteria**:
- [ ] Users can choose between Google OAuth and email/password signup
- [ ] Email/password form validates input correctly
- [ ] Signup creates Supabase auth user successfully
- [ ] Invitation is processed correctly after email/password signup
- [ ] Email verification flow works (if required by Supabase config)
- [ ] Error messages are clear and helpful

---

### Phase 3: Show Account Invite Links in AccountManagement

**Goal**: App owner can view and manage all pending invitations for accounts they've created.

**Changes Required**:

1. **Add Invitation List to AccountManagement**
   - Fetch pending invitations for each account
   - Display invitations grouped by account
   - Show invitation details: email, role, created date, expiration date, status
   - Display invitation link with copy button

2. **Add Invitation Management Functions**
   - `getPendingInvitationsForAccount(accountId: string)` - Fetch invitations
   - Display invitations in expandable sections per account
   - Add "View Invitations" button/link for each account

3. **Add Invitation Actions**
   - Copy invitation link
   - Regenerate invitation link (if needed - may require new function)
   - View invitation status (pending/accepted/expired)
   - Optionally: Resend invitation (if email sending is added later)

4. **Update UI Layout**
   - Show accounts list with invitation count badges
   - Expandable sections to show invitations per account
   - Or separate "Account Invitations" section showing all invitations

**Files to Modify**:
- `src/components/auth/AccountManagement.tsx`
- `src/services/supabase.ts` (may need new function or update existing)

**New Functions Needed** (if not already exists):
- `getPendingInvitationsForAccount(accountId: string)` - Already exists as `getPendingInvitations()`, may need to verify it works for owner viewing all accounts

**Acceptance Criteria**:
- [ ] App owner can see all pending invitations for accounts they created
- [ ] Invitations are clearly associated with their accounts
- [ ] Invitation links can be copied
- [ ] Invitation status is visible (pending/accepted/expired)
- [ ] UI is clean and organized

---

## Technical Considerations

### Database Schema
- ✅ `invitations` table already has `token` column (migration 008)
- ✅ Token is unique and indexed
- No additional schema changes needed

### Security Considerations
- ✅ Invitation tokens are cryptographically random (64 hex chars)
- ✅ Tokens expire after 7 days
- ✅ Single-use tokens (status changes to 'accepted' after use)
- ✅ RLS policies restrict invitation access appropriately
- ⚠️ Consider: Should app owner be able to see all invitations or only ones they created?

### Email Verification
- Need to check Supabase project settings for email confirmation requirement
- If enabled, users must verify email before account is fully activated
- May need to store invitation token until email is verified
- Consider: Should invitation acceptance wait for email verification, or happen immediately?

### Error Handling
- Handle case where invitation token is invalid/expired
- Handle case where email already exists (user already signed up)
- Handle case where user signs up with different email than invitation
- Provide clear error messages for all failure cases

### User Experience
- Show loading states during signup
- Provide clear success messages
- Guide users through email verification if required
- Make invitation links easy to copy and share

---

## Implementation Order

**Recommended Sequence**:

1. **Phase 1** (Quick win) - Fix AccountManagement to show invite links
   - Small change, immediate value
   - Unblocks app owner workflow

2. **Phase 2** (Core feature) - Add email/password signup
   - More complex, but essential for flexibility
   - Requires testing email verification flow

3. **Phase 3** (Enhancement) - Show account invite links in AccountManagement
   - Nice-to-have for managing multiple accounts
   - Can be done after Phase 1 & 2 are stable

---

## Testing Checklist

### Phase 1 Testing
- [ ] Create account as app owner
- [ ] Verify invitation link is displayed
- [ ] Copy link to clipboard
- [ ] Verify link works when accessed
- [ ] Test with multiple account creations

### Phase 2 Testing
- [ ] Sign up with Google OAuth via invitation link
- [ ] Sign up with email/password via invitation link
- [ ] Verify invitation is accepted correctly for both methods
- [ ] Test with expired invitation token
- [ ] Test with invalid invitation token
- [ ] Test email verification flow (if enabled)
- [ ] Test error cases (email exists, weak password, etc.)

### Phase 3 Testing
- [ ] View invitations as app owner
- [ ] See invitations grouped by account
- [ ] Copy invitation links from AccountManagement
- [ ] Verify invitation status displays correctly
- [ ] Test with multiple accounts and invitations

---

## Future Enhancements (Out of Scope)

- Email sending integration (SendGrid, Mailgun, etc.)
- Invitation link regeneration
- Bulk invitation creation
- Invitation analytics (who clicked, when, etc.)
- Custom invitation messages
- Invitation templates

---

## Notes

- Current implementation uses localStorage to pass invitation token through OAuth redirect
- Same pattern can be used for email/password signup
- Consider adding invitation link to account object/context for easier access
- May want to add invitation expiration warnings in UI
- Consider rate limiting on invitation creation to prevent abuse

