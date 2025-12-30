# 1584 Design

A modern, mobile-first inventory management application built with React, TypeScript, and Supabase.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account and project

### 1. Clone and Setup

```bash
# Install dependencies
npm install
```

### 2. Configure Supabase

1. Go to [Supabase Console](https://app.supabase.com/)
2. Create a new project or select existing one
3. Enable the following services:
   - **PostgreSQL Database** (automatically enabled)
   - **Authentication** (enable Google OAuth provider)
   - **Storage** (for images)
   - **Realtime** (for real-time updates)

#### 🔧 Configure Supabase Storage

1. **Create Storage Buckets:**
   ```bash
   npm run setup:storage
   ```

2. **Configure CORS** (if needed):
   - Go to Storage > Settings in Supabase Dashboard
   - Configure CORS settings for your domain

3. **Get your Supabase configuration:**
   - Go to Project Settings > API
   - Copy the Project URL and anon/public key

### 3. Update Configuration

Create a `.env` file in the root directory with your Supabase configuration:

```bash
# Copy the example file
cp .env.example .env
```

Then edit `.env` and add your Supabase credentials:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Where to find these values:**
- Go to your Supabase project dashboard
- Navigate to **Project Settings > API**
- Copy the **Project URL** and **anon/public key**

### 4. Run Database Migrations

```bash
# Apply database migrations
# Migrations are located in supabase/migrations/
# Apply them through Supabase Dashboard or CLI
```

### 4.5 Deploy Supabase Edge Functions (if applicable)

```bash
# Example: deploy the HighLevel onboarding webhook
supabase functions deploy highlevel-onboard \
  --project-ref <your-project-ref>
```

Set the secrets listed in the “HighLevel Onboarding Webhook” section before deploying.

### 5. Run Development Server

```bash
# Start the development server
npm run dev
```

### 6. Deploy to Production

The application is configured for deployment with Cloudflare Pages or similar static hosting:

```bash
# Build for production
npm run build

# Deploy the dist/ directory to your hosting provider
```

## 📁 Project Structure

```
├── dev_docs/                 # Planning and architecture documents
│   ├── ARCHITECTURE.md       # System architecture and design
│   ├── DATA_SCHEMA.md        # Database schema structure
│   ├── COMPONENT_ARCHITECTURE.md # Component hierarchy
│   ├── STYLE_GUIDE.md        # Design system and styling
│   └── SECURITY_PLAN.md      # Security rules and performance
├── supabase/
│   └── migrations/           # Database migration files
├── public/                    # Static assets
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── layout/           # Layout components (Header, Sidebar, MobileMenu)
│   │   ├── auth/             # Authentication components
│   │   └── ui/               # Reusable UI components
│   ├── pages/                # Route components
│   │   ├── Projects.tsx      # Project overview (default landing page)
│   │   ├── ProjectDetail.tsx # Project details with Inventory/Transactions tabs
│   │   ├── InventoryList.tsx # Project-specific inventory management
│   │   ├── TransactionsList.tsx # Project-specific transaction management
│   │   └── ItemDetail.tsx    # Individual item detail view
│   ├── services/             # Supabase and external services
│   ├── contexts/             # React contexts (Auth, Account, BusinessProfile)
│   ├── hooks/                # Custom React hooks
│   ├── types/                # TypeScript type definitions
│   └── index.css             # Global styles
└── package.json              # Dependencies and scripts
```

## 🎯 Key Features

- **Project-Centric Design**: Organized around Projects as the main entities
- **Mobile-First Design**: Optimized for mobile devices with responsive layout
- **Clean Navigation**: Focused interface without unnecessary settings or analytics
- **Project-Based Inventory**: Inventory and transactions organized within projects
- **List View Interface**: Clean, efficient inventory management in list format
- **Modern UI**: Built with React, TypeScript, and Tailwind CSS
- **Scalable Architecture**: Supabase Postgres ready for data storage
- **Real-time Updates**: Supabase Realtime subscriptions for live data

## 🛠 Development

### Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run build            # Build for production
npm run preview          # Preview production build

# Testing
npm run test             # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage

# Linting
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint errors
npm run type-check       # TypeScript type checking

# Supabase
npm run setup:storage    # Setup Supabase storage buckets
npm run test:storage     # Test Supabase storage configuration
```

### Development Guidelines

1. **Mobile-First**: Design for mobile (320px+) first, then scale up
2. **Component Structure**: Use functional components with TypeScript
3. **State Management**: Use React Context and Zustand for global state
4. **Styling**: Use Tailwind CSS with custom design tokens
5. **Accessibility**: Follow WCAG AA guidelines
6. **Database**: Use Supabase Postgres with Row Level Security (RLS)

## 📱 Mobile Optimization

- Touch-friendly interfaces (44px minimum touch targets)
- Responsive typography and spacing
- Optimized images for different screen densities
- Progressive Web App capabilities
- Project-focused navigation for mobile workflows

## 🔒 Security

- Row Level Security (RLS) policies for data protection
- Authentication with Supabase Auth (Google OAuth)
- Input validation and sanitization
- HTTPS-only hosting
- Account-based multi-user support

## 🚀 Deployment

The application is configured for deployment with Cloudflare Pages or similar static hosting providers (Vercel, Netlify, etc.).

### Build for Production

```bash
npm run build
```

This creates an optimized production build in the `dist/` directory.

### Deploy

Upload the `dist/` directory to your hosting provider:

- **Cloudflare Pages**: Connect your repository and set build command to `npm run build`
- **Vercel**: Connect your repository - Vercel will auto-detect Vite
- **Netlify**: Connect your repository and set build command to `npm run build` and publish directory to `dist`

### Environment Variables

Set these environment variables in your hosting provider's dashboard:

- `VITE_SUPABASE_URL`: Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: Your Supabase anon/public key

**Important:** These are public environment variables that will be embedded in your client-side bundle. The anon key is safe to expose as it's designed for client-side use and respects Row Level Security policies.

## 🔗 HighLevel Onboarding Webhook

- **Function implementation**: `supabase/functions/highlevel-onboard/index.ts`
- **Database log**: `public.highlevel_onboarding_events` (migration `20251223_create_highlevel_onboarding_events.sql`).
 - **Execution flow**:
  1. HighLevel issues a POST request to the Supabase Edge Function URL (or a vanity URL that proxies to it) after payment success.
  2. The function validates the HMAC signature (`X-HL-Signature`), enforces the `Idempotency-Key`, provisions an account, and either attaches an existing user or creates a fresh invitation.
  3. Response payload mirrors `{ status, account_id, invitation_link?, login_url?, idempotency_key }`, so HighLevel can drop the invite/login link directly into its outbound email.
 - **Secrets to set before deploying** (via `supabase secrets set`):
  - `APP_BASE_URL` (and optional `APP_LOGIN_URL`)
  - `HL_WEBHOOK_HMAC_SECRET`
  - `ONBOARDING_INVITER_USER_ID` (optional system user UUID for attribution)
  - `ONBOARDING_INVITE_EXPIRATION_DAYS` (defaults to `7`)
 - **Production endpoint**: `https://<project-ref>.functions.supabase.co/highlevel-onboard` — proxy behind `https://api.yoursite.com/hook/highlevel/onboard` if you prefer a branded URL.

### Cloudflare Pages Configuration

The project includes `wrangler.toml` for Cloudflare Pages deployment. The build process is configured to:
- Build with Node.js 18
- Output to `dist/` directory
- Set appropriate headers for security and caching

## 📊 Performance

- **Lighthouse Score**: Target 90+ for all categories
- **Core Web Vitals**: All metrics in "Good" range
- **Bundle Size**: Optimized for fast loading
- **Real-time Updates**: Efficient Supabase Realtime subscriptions

## 🤝 Contributing

1. Follow the established code style and architecture
2. Write tests for new features
3. Update documentation as needed
4. Use meaningful commit messages
5. Ensure mobile responsiveness

## 📄 License

This project is private and proprietary.

## 🆘 Support

For support and questions, please refer to the documentation in the `dev_docs/` directory or contact the development team.

- **Item-lineage troubleshooting**: If you observe errors mentioning `item_lineage_edges`, `PGRST205`, `404`, or `406` during deallocation/lineage operations, follow the checklist in `dev_docs/troubleshooting/transaction-lineage-troubleshooting.md`.

---

**Built with ❤️ for 1584 Design**
