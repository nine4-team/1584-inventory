---
name: Multi-Tenant Hierarchical Data Structure & Business Profile
overview: ""
todos: []
isProject: false
---

# Multi-Tenant Hierarchical Data Structure & Business Profile

## Overview

Restructure the entire Firestore data model to use hierarchical account-based isolation. All data collections (projects, items, transactions) will be nested under accounts, ensuring complete data isolation between different companies. Implement simplified two-level role system (system owner + per-account admin/user). Then implement business profiles scoped to each account.

## Architecture Decisions

- **Hierarchical Structure**: All data nested under `accounts/{accountId}/`
- **Terminology**: Use "accounts" not "organizations"
- **Business Profile**: `accounts/{accountId}/businessProfile`
- **Projects**: `accounts/{accountId}/projects/{projectId}`
- **Items**: `accounts/{accountId}/items/{itemId}`
- **Transactions**: `accounts/{accountId}/transactions/{transactionId}`
- **Users**: Remain top-level with `accountId` field
- **Account Membership**: Roles stored in `accounts/{accountId}/members/{userId}`

## Role System

### System-Level Owner Role (on User document)

- `User.role = 'owner'` - App-wide super admin
- Can create/manage accounts
- Can change roles in any account
- Can access data across accounts
- First user becomes owner automatically

### Account-Level Roles (in AccountMembership)

- `'admin'` - Full access to account (manage users, settings, business profile)
- `'user'` - Standard access (create/edit projects, items, transactions)
- Stored in: `accounts/{accountId}/members/{userId}`

## New Data Structure

### Firestore Collections

```
accounts/
  {accountId}/
    businessProfile/          # Single document
    members/                  # Account membership with roles
      {userId}/               # Contains role: 'admin' | 'user'
    projects/
      {projectId}/
    items/
      {itemId}/
    transactions/
      {transactionId}/
    settings/                 # Account-level settings (e.g., tax presets)
      {settingId}/
    audit_logs/
      {auditId}/
    transaction_audit_logs/
      {auditId}/

users/                        # Top-level
  {userId}/                   # Contains accountId field, role='owner' for system admin

invitations/                  # Top-level, scoped by accountId field
  {invitationId}/             # Contains accountId field
```

### Type Definitions

```typescript
interface Account {
  id: string
  name: string
  createdAt: Date
  createdBy: string
}

interface User {
  id: string
  email: string
  displayName: string
  accountId: string              // Links user to account
  role?: 'owner' | null          // System-level owner (optional)
  createdAt: Date
  lastLogin: Date
}

interface AccountMembership {
  userId: string
  accountId: string
  role: 'admin' | 'user'         // Account-level role
  joinedAt: Date
}

interface BusinessProfile {
  name: string
  logoUrl: string | null
  updatedAt: Date
  updatedBy: string
  accountId: string
}

enum UserRole {
  OWNER = 'owner',    // System-level super admin
  ADMIN = 'admin',    // Account-level admin
  USER = 'user'       // Account-level user
}
```

## Implementation Phases

### Phase 1: Account System Foundation

#### 1.1 Create Account Types & Interfaces

**File**: `src/types/index.ts`

- Add `Account` interface
- Add `AccountMembership` interface
- Update `User` interface: add `accountId`, keep `role` for owner
- Update `UserRole` enum: OWNER, ADMIN, USER
- Add `BusinessProfile` interface
- Update `Invitation` interface to include `accountId`

#### 1.2 Create Account Service

**File**: `src/services/accountService.ts` (new)

- `createAccount(name: string, createdBy: string)`: Create account (owners only)
- `getAccount(accountId: string)`: Get account details
- `getUserAccount(userId: string)`: Get account for user
- `getUserRoleInAccount(userId: string, accountId: string)`: Get account role
- `addUserToAccount(userId: string, accountId: string, role: 'admin' | 'user')`: Add user with role
- `updateUserRoleInAccount(userId: string, accountId: string, role: 'admin' | 'user')`: Update role (owner or account admin)
- `removeUserFromAccount(userId: string, accountId: string)`: Remove user
- Store memberships: `accounts/{accountId}/members/{userId}`

#### 1.3 Create Account Context

**File**: `src/contexts/AccountContext.tsx` (new)

- Load account from current user's `accountId`
- Load user's role from membership: `accounts/{accountId}/members/{userId}`
- Check for system owner: `user?.role === 'owner'`
- Expose `currentAccountId`, `currentAccount`
- Expose `isOwner: boolean` (system-level)
- Expose `isAdmin: boolean` (account-level OR system owner)
- Expose `userRole: 'admin' | 'user'` (account-level role)

#### 1.4 Update Auth Context

**File**: `src/contexts/AuthContext.tsx`

- Keep `role` field on User (for system owner)
- First user ever created becomes 'owner'
- Add `isOwner()` method: `user?.role === 'owner'`
- Remove/update `hasRole()` - roles now in AccountContext
- Create default account for first user if none exists
- Handle account assignment during user creation

### Phase 2: Restructure All Service Queries

#### 2.1 Update Project Service

**File**: `src/services/inventoryService.ts` - `projectService`

- Change `collection(db, 'projects')` → `collection(db, 'accounts', accountId, 'projects')`
- Update all project queries to use account-scoped collection
- Update `createProject` to include accountId in path
- Update `getProjects()` to filter by current account

#### 2.2 Update Item Service

**File**: `src/services/inventoryService.ts` - `unifiedItemsService`

- Change `collection(db, 'items')` → `collection(db, 'accounts', accountId, 'items')`
- Update all item queries to be account-scoped

#### 2.3 Update Transaction Service

**File**: `src/services/inventoryService.ts` - `transactionService`

- Change `collection(db, 'transactions')` → `collection(db, 'accounts', accountId, 'transactions')`
- Update all transaction queries to be account-scoped
- Update legacy subcollection queries

#### 2.4 Update Audit Service

**File**: `src/services/inventoryService.ts` - `auditService`

- Change collections to account-scoped paths

#### 2.5 Update Settings/Tax Presets Service

**File**: `src/services/taxPresetsService.ts`

- Change `collection(db, 'settings')` → `collection(db, 'accounts', accountId, 'settings')`
- Update all tax preset queries to be account-scoped

### Phase 3: Update All Components

Update all components that call service methods to pass `accountId` from `useAccount()` hook.

### Phase 4: Business Profile Implementation

#### 4.1 Create Business Profile Service

**File**: `src/services/businessProfileService.ts` (new)

- `getBusinessProfile(accountId: string)`: Fetch business profile
- `updateBusinessProfile(accountId: string, name: string, logoUrl?: string)`: Update profile
- Store: `accounts/{accountId}/businessProfile` document

#### 4.2 Create Business Profile Context

**File**: `src/contexts/BusinessProfileContext.tsx` (new)

- Load profile based on current account from AccountContext
- Expose `businessName` and `businessLogoUrl` with fallbacks

#### 4.3 Update Settings Page

**File**: `src/pages/Settings.tsx`

- Add "Business Profile" section (admin-only)
- Fields: Business Name, Business Logo upload
- Logo path: `accounts/{accountId}/business_profile/logo/{timestamp}_{filename}`

#### 4.4 Update Image Upload Service

**File**: `src/services/imageService.ts`

- Add method for business logo uploads with account-scoped path

#### 4.5 Update Header Component

**File**: `src/components/layout/Header.tsx`

- Use `businessName` from BusinessProfileContext
- Fallback to `COMPANY_NAME` constant

#### 4.6 Update Invoice Generation

**File**: `src/pages/ProjectInvoice.tsx`

- Use `businessLogoUrl` and `businessName` from context

### Phase 5: Security Rules & Storage Rules

#### 5.1 Update Firestore Security Rules

**File**: `firestore.rules`

- Add `isSystemOwner()` helper
- Add `getUserAccountId()` helper
- Add `isAccountMember(accountId)` helper
- Add `getUserRoleInAccount(accountId)` helper
- Add `isAccountAdmin(accountId)` helper
- Update all rules to be account-scoped with owner/admin checks

#### 5.2 Update Storage Rules

**File**: `storage.rules`

- Add account-scoped rules for logo uploads
- Owners can access any account's storage

### Phase 6: Data Migration

#### 6.1 Migration Script

**File**: `migration/migrate-to-accounts.cjs` (new)

- Create default account
- First user becomes system 'owner'
- Map old roles:
  - OWNER → system 'owner' (on User)
  - ADMIN → account 'admin' (in membership)
  - DESIGNER/VIEWER → account 'user' (in membership)
- Migrate all data to account-scoped paths
- Create membership documents for all users

#### 6.2 Migration Validation

**File**: `migration/validate-accounts-migration.cjs` (new)

- Verify all data migrated
- Validate account assignments and roles

### Phase 7: Firestore Indexes

**File**: `firestore.indexes.json`

- Update indexes to include accountId
- Add membership indexes

## Files to Create

- `src/services/accountService.ts`
- `src/contexts/AccountContext.tsx`
- `src/services/businessProfileService.ts`
- `src/contexts/BusinessProfileContext.tsx`
- `migration/migrate-to-accounts.cjs`
- `migration/validate-accounts-migration.cjs`

## Files to Modify

- `src/types/index.ts` - Add Account, AccountMembership, BusinessProfile, update UserRole, keep role on User
- `src/services/inventoryService.ts` - All queries account-scoped
- `src/services/taxPresetsService.ts` - Account-scoped queries
- `src/services/imageService.ts` - Account-scoped logo uploads
- `src/services/firebase.ts` - Account creation, first user becomes owner
- `src/contexts/AuthContext.tsx` - Add isOwner(), account assignment
- `src/pages/Settings.tsx` - Business Profile section
- `src/components/layout/Header.tsx` - Use business name
- `src/pages/ProjectInvoice.tsx` - Use business name and logo
- All page components - Use `useAccount()` hook
- `src/App.tsx` - Wrap with AccountProvider and BusinessProfileProvider
- `firestore.rules` - Account-scoped security rules with owner checks
- `storage.rules` - Account-scoped storage rules
- `firestore.indexes.json` - Update indexes

## Testing Considerations

- Test system owner can create accounts
- Test system owner can change roles in any account
- Test system owner can access data across accounts
- Test account admin can only manage their own account
- Test account user cannot access admin features
- Test first user becomes system owner
- Test role assignment in account memberships
- Test data isolation between accounts
- Test business profile (admin-only, owner can do any)
- Test migration script with role mapping

## Migration Strategy

1. **Development**: Implement new structure
2. **Staging**: Run migration, validate, test
3. **Production**: Backup, migrate, deploy, monitor