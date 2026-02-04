// Core types for the inventory management system

import { CLIENT_OWES_COMPANY, COMPANY_OWES_CLIENT } from '@/constants/company'

// Tax preset interface (imported from constants for consistency)
export interface TaxPreset {
  id: string;
  name: string;
  rate: number; // percentage, e.g., 8.375
}

// Item disposition union type - canonical values for item disposition
export type ItemDisposition = 'to purchase' | 'purchased' | 'to return' | 'returned' | 'inventory'

export interface BudgetCategory {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  isArchived: boolean;
  metadata?: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id: string;
  name: string; // Account name and business name (consolidated from business_name)
  createdAt: Date;
  createdBy: string;
  // Business profile fields (consolidated from business_profiles table)
  businessLogoUrl?: string | null;
  businessProfileUpdatedAt?: Date | null;
  businessProfileUpdatedBy?: string | null;
  businessProfileVersion?: number | null;
}


export interface BusinessProfile {
  name: string;
  logoUrl: string | null;
  updatedAt: Date;
  updatedBy: string;
  accountId: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  accountId: string; // Links user to account
  role?: 'owner' | 'admin' | 'user' | null; // System owner, account admin, or account user
  createdAt: Date;
  lastLogin: Date;
}

export enum UserRole {
  OWNER = 'owner',    // System-level super admin
  ADMIN = 'admin',    // Account-level admin
  USER = 'user'       // Account-level user
}

export interface Invitation {
  id: string;
  email: string;
  accountId: string;
  role: 'admin' | 'user';
  invitedBy: string;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date;
}

export interface Project {
  id: string;
  accountId?: string;
  name: string;
  description: string;
  clientName: string;
  budget?: number;
  designFee?: number;
  budgetCategories?: ProjectBudgetCategories;
  defaultCategoryId?: string;
  mainImageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  settings?: ProjectSettings;
  metadata?: ProjectMetadata;
  itemCount?: number;
  transactionCount?: number;
  totalValue?: number;
}

// ProjectBudgetCategories maps category IDs to budget amounts
// Format: { [categoryId: string]: number }
// This allows projects to use dynamic budget categories from the budget_categories table
export type ProjectBudgetCategories = Record<string, number>

export interface ProjectSettings {
  allowPublicAccess?: boolean;
  notificationsEnabled?: boolean;
  locations?: string[];
}

export interface ProjectMetadata {
  totalItems: number;
  lastActivity: Date;
  completionPercentage: number;
}

export interface SpaceChecklistItem {
  id: string; // UUID
  text: string;
  isChecked: boolean; // Space only; Template should store false for all items
}

export interface SpaceChecklist {
  id: string; // UUID
  name: string;
  items: SpaceChecklistItem[];
}

export interface Space {
  id: string;
  accountId: string;
  projectId?: string | null; // null = account-wide, UUID = project-specific
  templateId?: string | null; // Optional provenance: set when space is created from a template
  name: string;
  notes?: string | null;
  images?: ItemImage[]; // Reuse ItemImage shape; isPrimary determines representative image
  checklists?: SpaceChecklist[]; // Multiple named checklists with completion state
  isArchived: boolean;
  metadata?: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
  version: number;
}

export interface SpaceTemplate {
  id: string;
  accountId: string;
  name: string;
  notes?: string | null;
  checklists?: SpaceChecklist[]; // Checklist defaults (all items should have isChecked=false)
  isArchived: boolean;
  sortOrder?: number | null;
  metadata?: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
  version: number;
}

export interface Item {
  // Note: This interface uses camelCase for all fields (TypeScript/JavaScript convention)
  // Field mapping to Supabase (snake_case) happens in the service layer conversion functions
  itemId: string;
  accountId?: string;
  projectId?: string | null;   // null = business inventory, string = allocated to project
  transactionId?: string | null;
  previousProjectTransactionId?: string | null;
  previousProjectId?: string | null;
  name?: string;
  description: string;
  source: string;
  sku: string;
  price?: string;               // What we paid for the item (used in forms)
  purchasePrice?: string;      // What we paid for the item
  projectPrice?: string;       // What we sell it for (Design Business project price) - formerly resale_price
  marketValue?: string;        // Current market value - direct mapping
  paymentMethod: string;
  disposition?: ItemDisposition | null;
  notes?: string;
  space?: string;               // Legacy: Space/location where item is placed (deprecated, use spaceId)
  spaceId?: string | null;     // Foreign key to spaces table
  qrKey: string;
  bookmark: boolean;
  dateCreated: string;
  lastUpdated: string;
  images?: ItemImage[];         // Images associated with this item
  // Tax fields
  taxRatePct?: number | null; // percentage, e.g., 8.25; null = none
  taxAmountPurchasePrice?: string; // Tax amount applied to `purchasePrice` (stored as four-decimal string; display as 2-decimal)
  taxAmountProjectPrice?: string;  // Tax amount applied to `projectPrice` (stored as four-decimal string; display as 2-decimal)
  createdBy?: string;
  createdAt?: Date;

  // Optional transaction selection for form UI
  selectedTransactionId?: string; // UI field for selecting transaction

  // Business Inventory fields (unified with Item)
  inventoryStatus?: 'available' | 'allocated' | 'sold';
  businessInventoryLocation?: string; // Warehouse location details

  // Lineage tracking fields
  originTransactionId?: string | null;  // Immutable: transaction id at creation/intake
  latestTransactionId?: string | null;  // Denormalized: current transaction association; null = in inventory
}

// Note: ItemCategory and ItemStatus enums have been removed as they don't align
// with the original Apps Script schema. The forms now use the correct field structure
// that matches the original inventory system.

export interface ItemImage {
  url: string;
  alt: string;
  isPrimary: boolean;
  uploadedAt: Date;
  fileName: string;
  size: number; // in bytes
  mimeType: string;
  caption?: string; // Optional caption for the image
  metadata?: {
    offlineMediaId?: string;
    isOfflinePlaceholder?: boolean;
  };
}

export interface TransactionImage {
  url: string;
  fileName: string;
  uploadedAt: Date;
  size: number; // in bytes
  mimeType: string;
  metadata?: {
    offlineMediaId?: string;
    isOfflinePlaceholder?: boolean;
  };
}

export interface Dimensions {
  width: number;
  height: number;
  depth?: number;
  unit: 'inches' | 'cm' | 'mm';
}

export interface ItemLocation {
  storage: string;
  shelf: string;
  position: string;
}

export interface QRCodeData {
  data: string;
  generatedAt: Date;
  lastScanned?: Date;
}

export interface FilterOptions {
  disposition?: ItemDisposition | string;
  source?: string;
  status?: string; // For filtering by item status
  category?: string; // For filtering by category
  tags?: string[];
  priceRange?: {
    min: number;
    max: number;
  };
  searchQuery?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  total?: number;
}

export interface ApiError {
  type: ErrorType;
  message: string;
  code?: string;
  details?: any;
}

export interface Transaction {
  /**
   * Primary key of the row in the transactions table.
   * Used to reconcile realtime DELETE payloads that omit transaction_id.
   */
  rowId?: string;
  transactionId: string;
  projectId?: string | null;
  projectName?: string | null;
  transactionDate: string;
  source: string;
  transactionType: string;
  paymentMethod: string;
  amount: string;
  budgetCategory?: string; // Legacy field - kept for backward compatibility
  categoryId?: string; // New field - FK to budget_categories.id
  notes?: string;
  transactionImages?: TransactionImage[]; // Legacy field for backward compatibility
  receiptImages?: TransactionImage[]; // New field for receipt images
  otherImages?: TransactionImage[]; // New field for other images
  receiptEmailed: boolean;
  createdAt: string;
  createdBy: string;

  // NEW: Pending Transaction fields for Enhanced Transaction System
  status?: 'pending' | 'completed' | 'canceled';
  reimbursementType?: typeof CLIENT_OWES_COMPANY | typeof COMPANY_OWES_CLIENT | '' | null | undefined;
  triggerEvent?: 'Inventory allocation' | 'Inventory return' | 'Inventory sale' | 'Purchase from client' | 'Manual';

  // NEW: Item linkage for unified inventory system
  itemIds?: string[]; // Links to items in the top-level items collection
  // Tax fields
  taxRatePreset?: string | null; // ID of the selected preset (e.g., 'nv', 'ut', etc.) or 'Other' for custom; null = none
  taxRatePct?: number | null; // percentage, e.g., 8.25 (calculated from preset or subtotal); null = none
  subtotal?: string | null; // pre-tax amount as string, e.g. '100.00' (used when tax_rate_preset is 'Other'); null = none
  needsReview?: boolean; // Denormalized flag from DB: true if transaction needs audit review
  sumItemPurchasePrices?: string; // Denormalized numeric string stored as two-decimal string, e.g. '123.45'
}

export enum BudgetCategory {
  DESIGN_FEE = 'Design Fee',
  FURNISHINGS = 'Furnishings',
  PROPERTY_MANAGEMENT = 'Property Management',
  KITCHEN = 'Kitchen',
  INSTALL = 'Install',
  STORAGE_RECEIVING = 'Storage & Receiving',
  FUEL = 'Fuel'
}

export enum ErrorType {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NETWORK = 'network',
  SERVER = 'server',
  CLIENT = 'client'
}

// Transaction form types and validation
export interface TransactionFormData {
  transactionDate: string;
  source: string;
  transactionType: string;
  paymentMethod: string;
  amount: string;
  budgetCategory?: string; // Legacy field - kept for backward compatibility
  categoryId?: string; // New field - FK to budget_categories.id
  notes?: string;
  status?: 'pending' | 'completed' | 'canceled';
  reimbursementType?: typeof CLIENT_OWES_COMPANY | typeof COMPANY_OWES_CLIENT | '' | null | undefined;
  triggerEvent?: 'Inventory allocation' | 'Inventory return' | 'Inventory sale' | 'Purchase from client' | 'Manual';
  transactionImages?: File[]; // Legacy field for backward compatibility
  receiptImages?: File[]; // New field for receipt image files
  otherImages?: File[]; // New field for other image files
  receiptEmailed?: boolean;
  items?: TransactionItemFormData[];
  // Tax form fields
  taxRatePreset?: string | null; // ID of the selected preset (e.g., 'nv', 'ut', etc.) or 'Other' for custom; null = none
  subtotal?: string | null; // pre-tax amount as string, e.g. '100.00' (used when tax_rate_preset is 'Other'); null = none
}

export interface TransactionItemFormData {
  id: string; // temporary id for form management
  transactionId?: string;
  description: string;
  sku?: string;
  price?: string; // What we paid for the item (used in forms)
  purchasePrice?: string; // What we paid for the item
  projectPrice?: string; // What we sell it for (Design Business project price) - formerly resale_price
  marketValue?: string;
  space?: string;
  notes?: string;
  disposition?: ItemDisposition | string | null;
  // Item-level tax amounts (stored as strings; persisted to `items.tax_amount_*` columns)
  taxAmountPurchasePrice?: string;
  taxAmountProjectPrice?: string;
  images?: ItemImage[]; // Images associated with this item
  imageFiles?: File[]; // File objects for upload (not persisted)
  // UI-only field for grouping duplicate items (not persisted)
  uiGroupKey?: string;
}

export interface TransactionValidationErrors {
  transactionDate?: string;
  source?: string;
  transactionType?: string;
  paymentMethod?: string;
  amount?: string;
  budgetCategory?: string; // Legacy field - kept for backward compatibility
  categoryId?: string; // New field - FK to budget_categories.id
  notes?: string;
  status?: string;
  reimbursementType?: string;
  triggerEvent?: string;
  transactionImages?: string; // Legacy field for backward compatibility
  receiptImages?: string; // New field for receipt image errors
  otherImages?: string; // New field for other image errors
  receiptEmailed?: string;
  items?: string; // General error for items
  general?: string; // General form error
}

export interface TransactionItemValidationErrors {
  description?: string;
  sku?: string;
  price?: string; // Used in form validation
  purchasePrice?: string;
  projectPrice?: string; // What we sell it for (Design Business project price) - formerly resale_price
  marketValue?: string;
  space?: string;
  notes?: string;
}

export interface TransactionFormProps {
  projectId: string;
  transactionId?: string;
  onSubmit: (data: TransactionFormData) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<TransactionFormData>;
  isEditing?: boolean;
}

// Business Inventory Types (REMOVED: Use Item interface instead)
// All business inventory functionality now uses the unified Item interface

// Business Inventory Summary Stats
export interface BusinessInventoryStats {
  totalItems: number;
  availableItems: number;
  allocatedItems: number;
  soldItems: number;
}

// Utility type for date values that might be Date, string, or number
export type DateValue = Date | string | number | { toDate?: () => Date; seconds?: number; nanoseconds?: number } | null | undefined

// Common interface for items that can be bookmarked
export interface BookmarkableItem {
  itemId: string;
  bookmark: boolean;
}

// Transaction Completeness Types
export type CompletenessStatus = 'complete' | 'near' | 'incomplete' | 'over'

export interface TransactionCompleteness {
  itemsNetTotal: number
  itemsCount: number
  itemsMissingPriceCount: number
  transactionSubtotal: number
  completenessRatio: number
  completenessStatus: CompletenessStatus
  missingTaxData: boolean
  inferredTax?: number
  taxAmount?: number
  varianceDollars: number
  variancePercent: number
}

// Item Lineage Edge - append-only record of item movement between transactions
export type ItemLineageMovementKind = 'sold' | 'returned' | 'correction' | 'association'
export type ItemLineageSource = 'app' | 'db_trigger' | 'migration'

export interface ItemLineageEdge {
  id: string;
  accountId: string;
  itemId: string;
  fromTransactionId: string | null;  // null == from inventory
  toTransactionId: string | null;     // null == to inventory
  movementKind?: ItemLineageMovementKind | null;
  source?: ItemLineageSource | null;
  createdAt: string;  // ISO timestamp
  createdBy?: string | null;  // UUID of user who created the edge
  note?: string | null;  // Optional note about the move
}
