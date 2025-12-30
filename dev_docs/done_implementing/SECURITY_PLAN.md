# Security and Performance Plan

## Overview

This document outlines the security rules, authentication strategy, performance optimization approaches, and monitoring systems for the 1584 Design system.

## Firestore Security Rules

### Security Rules Structure

#### Projects Collection Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Projects collection - users can only access their own projects
    match /projects/{projectId} {
      // Users can read projects they own or have access to
      allow read: if request.auth != null &&
        (request.auth.uid == resource.data.createdBy ||
         'collaborators' in resource.data &&
         request.auth.uid in resource.data.collaborators);

      // Users can create projects if authenticated
      allow create: if request.auth != null &&
        request.auth.uid == request.resource.data.createdBy;

      // Users can update projects they own
      allow update: if request.auth != null &&
        request.auth.uid == resource.data.createdBy;

      // Users can delete projects they own
      allow delete: if request.auth != null &&
        request.auth.uid == resource.data.createdBy;

      // Items subcollection inherits parent project permissions
      match /items/{itemId} {
        allow read, write: if request.auth != null &&
          (request.auth.uid == get(/databases/$(database)/documents/projects/$(projectId)).data.createdBy ||
           'collaborators' in get(/databases/$(database)/documents/projects/$(projectId)).data &&
           request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.collaborators);
      }
    }

    // Public data collection for QR codes (if needed)
    match /public/{document=**} {
      allow read: if true; // Public read access
      allow write: if false; // No public write access
    }

    // Users collection (for future multi-user features)
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Security Rule Functions

#### User Verification Function
```javascript
function isAuthenticated() {
  return request.auth != null;
}

function isOwner(userId) {
  return request.auth != null && request.auth.uid == userId;
}

function isCollaborator(projectId) {
  return request.auth != null &&
    exists(/databases/$(database)/documents/projects/$(projectId)) &&
    'collaborators' in get(/databases/$(database)/documents/projects/$(projectId)).data &&
    request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.collaborators;
}

function canAccessProject(projectId) {
  return isOwner(get(/databases/$(database)/documents/projects/$(projectId)).data.createdBy) ||
         isCollaborator(projectId);
}
```

### Data Validation Rules

#### Project Data Validation
```javascript
function validateProjectData() {
  // Required fields
  return request.resource.data.keys().hasAll(['name', 'createdBy', 'createdAt', 'updatedAt']) &&
         request.resource.data.name is string &&
         request.resource.data.name.size() >= 1 &&
         request.resource.data.name.size() <= 100 &&
         request.resource.data.createdBy == request.auth.uid &&
         request.resource.data.createdAt is timestamp &&
         request.resource.data.updatedAt is timestamp;
}

function validateItemData() {
  // Required fields for items
  return request.resource.data.keys().hasAll(['name', 'createdBy', 'createdAt', 'updatedAt']) &&
         request.resource.data.name is string &&
         request.resource.data.name.size() >= 1 &&
         request.resource.data.name.size() <= 100 &&
         request.resource.data.createdBy == request.auth.uid &&
         request.resource.data.createdAt is timestamp &&
         request.resource.data.updatedAt is timestamp;
}
```

## Authentication Strategy

### Firebase Authentication Setup

#### Authentication Methods
```javascript
// Supported authentication methods
const authMethods = [
  'email/password',
  'google.com',
  'github.com',
  'microsoft.com'
];

// Initialize Firebase Auth
const auth = getAuth(app);
```

#### User Registration and Login
```typescript
// User registration
const registerUser = async (email: string, password: string, displayName: string) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);

  // Update user profile
  await updateProfile(userCredential.user, {
    displayName: displayName
  });

  // Create user document in Firestore
  await setDoc(doc(db, 'users', userCredential.user.uid), {
    email: email,
    displayName: displayName,
    createdAt: new Date(),
    lastLogin: new Date()
  });

  return userCredential.user;
};

// User login
const loginUser = async (email: string, password: string) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);

  // Update last login
  await updateDoc(doc(db, 'users', userCredential.user.uid), {
    lastLogin: new Date()
  });

  return userCredential.user;
};
```

### Authorization Levels

#### User Roles and Permissions
```typescript
enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  DESIGNER = 'designer',
  VIEWER = 'viewer'
}

interface UserPermissions {
  canCreateProjects: boolean;
  canDeleteProjects: boolean;
  canManageUsers: boolean;
  canEditAllItems: boolean;
  canDeleteItems: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
}

const rolePermissions: Record<UserRole, UserPermissions> = {
  [UserRole.OWNER]: {
    canCreateProjects: true,
    canDeleteProjects: true,
    canManageUsers: true,
    canEditAllItems: true,
    canDeleteItems: true,
    canViewAnalytics: true,
    canExportData: true
  },
  [UserRole.ADMIN]: {
    canCreateProjects: true,
    canDeleteProjects: true,
    canManageUsers: false,
    canEditAllItems: true,
    canDeleteItems: true,
    canViewAnalytics: true,
    canExportData: true
  },
  [UserRole.DESIGNER]: {
    canCreateProjects: true,
    canDeleteProjects: false,
    canManageUsers: false,
    canEditAllItems: false,
    canDeleteItems: false,
    canViewAnalytics: false,
    canExportData: false
  },
  [UserRole.VIEWER]: {
    canCreateProjects: false,
    canDeleteProjects: false,
    canManageUsers: false,
    canEditAllItems: false,
    canDeleteItems: false,
    canViewAnalytics: false,
    canExportData: false
  }
};
```

## Performance Optimization

### Database Optimization

#### Query Performance
```typescript
// Batch operations for multiple writes
const batchCreateItems = async (projectId: string, items: ItemData[]) => {
  const batch = writeBatch(db);
  const projectRef = doc(db, 'projects', projectId);

  items.forEach((item, index) => {
    const itemRef = doc(collection(db, 'projects', projectId, 'items'));
    batch.set(itemRef, {
      ...item,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: auth.currentUser?.uid
    });
  });

  // Commit batch
  await batch.commit();
};
```

#### Index Optimization
```javascript
// Ensure proper indexes for common queries
const createIndexes = async () => {
  const indexes = [
    {
      collectionGroup: 'items',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'updatedAt', order: 'DESCENDING' }
      ]
    },
    {
      collectionGroup: 'items',
      fields: [
        { fieldPath: 'category', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'updatedAt', order: 'DESCENDING' }
      ]
    }
  ];

  // Apply indexes to Firestore
  await Promise.all(indexes.map(index => {
    // This would be configured in Firebase Console or via Firebase CLI
  }));
};
```

### Application Performance

#### Code Splitting Strategy
```typescript
// Lazy load route components
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Projects = lazy(() => import('./pages/Projects'));

// Lazy load heavy components
const QRCodeGenerator = lazy(() => import('./components/QRCodeGenerator'));
const ImageUploader = lazy(() => import('./components/ImageUploader'));
```

#### Image Optimization
```typescript
// Optimize images for different screen sizes
const optimizeImageUrl = (url: string, width: number, quality: number = 80) => {
  // Use Firebase Storage resize capabilities
  const storageRef = ref(storage, url);
  return getDownloadURL(storageRef).then(downloadUrl => {
    // Apply URL transformations for optimization
    return `${downloadUrl}?w=${width}&q=${quality}`;
  });
};
```

#### Caching Strategy
```typescript
// Implement service worker for caching
const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('SW registered: ', registration);
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    });
  }
};
```

## Data Protection and Privacy

### Data Encryption

#### Client-side Encryption
```typescript
// Encrypt sensitive data before storing
const encryptData = (data: string, key: string) => {
  // Use Web Crypto API for client-side encryption
  return crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: crypto.getRandomValues(new Uint8Array(12))
    },
    key,
    new TextEncoder().encode(data)
  );
};
```

#### Data Sanitization
```typescript
// Sanitize user input to prevent XSS
const sanitizeInput = (input: string) => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
    ALLOWED_ATTR: []
  });
};
```

### Privacy Controls

#### Data Retention Policy
```javascript
// Automatically delete old data
const cleanupOldData = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Delete items older than 30 days that are marked as sold
  const oldItemsQuery = query(
    collectionGroup(db, 'items'),
    where('status', '==', 'sold'),
    where('updatedAt', '<', thirtyDaysAgo)
  );

  const snapshot = await getDocs(oldItemsQuery);
  const batch = writeBatch(db);

  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
};
```

#### User Data Export/Delete
```typescript
// Allow users to export their data
const exportUserData = async (userId: string) => {
  const userDoc = await getDoc(doc(db, 'users', userId));
  const projectsSnapshot = await getDocs(
    query(collection(db, 'projects'), where('createdBy', '==', userId))
  );

  const userData = {
    user: userDoc.data(),
    projects: projectsSnapshot.docs.map(doc => doc.data())
  };

  return JSON.stringify(userData, null, 2);
};

// Allow users to delete their account and data
const deleteUserAccount = async (userId: string) => {
  // Delete user document
  await deleteDoc(doc(db, 'users', userId));

  // Delete all user projects and items
  const projectsSnapshot = await getDocs(
    query(collection(db, 'projects'), where('createdBy', '==', userId))
  );

  const batch = writeBatch(db);

  for (const projectDoc of projectsSnapshot.docs) {
    // Delete all items in the project
    const itemsSnapshot = await getDocs(
      collection(db, 'projects', projectDoc.id, 'items')
    );

    itemsSnapshot.docs.forEach((itemDoc) => {
      batch.delete(itemDoc.ref);
    });

    // Delete the project
    batch.delete(projectDoc.ref);
  }

  await batch.commit();

  // Delete Firebase Auth user
  const user = auth.currentUser;
  if (user) {
    await user.delete();
  }
};
```

## Error Handling and Logging

### Error Classification
```typescript
enum ErrorType {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NETWORK = 'network',
  SERVER = 'server',
  CLIENT = 'client'
}

interface AppError {
  type: ErrorType;
  message: string;
  code?: string;
  timestamp: Date;
  userId?: string;
  context?: any;
}
```

### Error Logging
```typescript
// Centralized error logging
const logError = (error: AppError) => {
  // Log to Firebase Analytics
  logEvent(analytics, 'exception', {
    error_type: error.type,
    error_message: error.message,
    error_code: error.code,
    user_id: error.userId,
    timestamp: error.timestamp.toISOString()
  });

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error logged:', error);
  }
};

// Global error handler
window.addEventListener('error', (event) => {
  logError({
    type: ErrorType.CLIENT,
    message: event.message,
    timestamp: new Date(),
    context: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    }
  });
});

// Promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  logError({
    type: ErrorType.CLIENT,
    message: event.reason?.message || 'Unhandled promise rejection',
    timestamp: new Date(),
    context: event.reason
  });
});
```

## Monitoring and Analytics

### Performance Monitoring
```typescript
// Monitor Core Web Vitals
const monitorWebVitals = () => {
  getCLS(console.log);
  getFID(console.log);
  getFCP(console.log);
  getLCP(console.log);
  getTTFB(console.log);
};
```

### Usage Analytics
```typescript
// Track user interactions
const trackUserAction = (action: string, metadata?: any) => {
  logEvent(analytics, 'user_action', {
    action,
    timestamp: new Date().toISOString(),
    user_id: auth.currentUser?.uid,
    ...metadata
  });
};

// Track feature usage
const trackFeatureUsage = (feature: string, usage: any) => {
  logEvent(analytics, 'feature_usage', {
    feature,
    ...usage,
    timestamp: new Date().toISOString(),
    user_id: auth.currentUser?.uid
  });
};
```

### Security Monitoring
```typescript
// Monitor failed authentication attempts
const monitorAuthFailures = () => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      logEvent(analytics, 'auth_failure', {
        reason: 'authentication_failed',
        timestamp: new Date().toISOString()
      });
    }
  });
};

// Monitor permission violations
const monitorPermissionViolations = () => {
  // This would be implemented in Firestore security rules
  // and logged via Firebase Functions
};
```

## Compliance and Best Practices

### GDPR Compliance
```typescript
// Consent management
const manageUserConsent = async (userId: string, consent: boolean) => {
  await updateDoc(doc(db, 'users', userId), {
    consentGiven: consent,
    consentDate: new Date()
  });
};

// Data processing transparency
const logDataProcessing = (operation: string, data: any) => {
  logEvent(analytics, 'data_processing', {
    operation,
    data_type: typeof data,
    timestamp: new Date().toISOString(),
    user_id: auth.currentUser?.uid
  });
};
```

### Security Best Practices

#### Input Validation
```typescript
// Server-side validation (in security rules)
function validateInput(input) {
  return input is string &&
         input.size() >= 1 &&
         input.size() <= 1000 &&
         input.matches('^[a-zA-Z0-9 ]*$'); // Only alphanumeric and spaces
}
```

#### Rate Limiting
```typescript
// Client-side rate limiting
const rateLimiter = {
  requests: new Map(),
  limit: 100, // requests per minute
  window: 60000, // 1 minute

  canMakeRequest: function(userId: string) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];

    // Remove old requests outside the window
    const recentRequests = userRequests.filter(
      timestamp => now - timestamp < this.window
    );

    if (recentRequests.length >= this.limit) {
      return false;
    }

    recentRequests.push(now);
    this.requests.set(userId, recentRequests);
    return true;
  }
};
```

This security and performance plan provides comprehensive protection for the inventory management system while ensuring optimal performance and user experience.
