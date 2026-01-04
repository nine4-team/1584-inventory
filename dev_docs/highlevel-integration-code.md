# HighLevel Integration Code

This document contains the correct code to use in HighLevel custom code blocks to trigger account creation when orders are received.

## Current Status

The `highlevel-onboard` Supabase Edge Function requires only `email` and `full_name` fields (no payment validation since HighLevel workflows only trigger on successful payments). The optional `business_name` is stored in metadata and used for account naming when provided.

## HighLevel Custom Code Block

Place this code in a HighLevel workflow custom code block that triggers on order/payment events.

**Only 4 fields are required**: `email`, `full_name`, `contact_id`, and `ledger_api_key`. Everything else is optional. The Edge Function reads the `full_name` field directly, so you do **not** need to remap anything inside HighLevel.

```javascript
// HighLevel Custom Code Block - Account Creation Trigger
// This runs after successful payment (HighLevel handles payment validation)

// MINIMAL payload - only required fields for account creation
const data = {
  email: inputData.email, // REQUIRED: User's email address
  full_name: inputData.full_name, // REQUIRED: Contact's full name
  contact_id: inputData.contact_id, // REQUIRED: HighLevel contact identifier for idempotency
  business_name: inputData.business_name // OPTIONAL: Business/company name for account naming
}

// Generate idempotency key based on contact_id to prevent duplicate processing
const idempotencyKey = `hl-contact-${data.contact_id}`

// Headers required by your Supabase function
const headers = {
  'Content-Type': 'application/json',
  'Idempotency-Key': idempotencyKey,
  'Authorization': `Bearer ${inputData.ledger_api_key}` // Ledger API key for authentication
}

// Make the request to your Supabase Edge Function
const postResponse = await customRequest.post('https://rwevbekceexnoaabdnbz.supabase.co/functions/v1/highlevel-onboard', {
  data,
  headers
})

// Log the response for debugging
console.log('HighLevel onboarding response:', postResponse)

// Handle response in HighLevel workflow
if (postResponse && postResponse.status === 200) {
  // Success - account created or user invited
  output = {
    success: true,
    invitation_link: postResponse.data ? postResponse.data.invitation_link : null,
    status: postResponse.data ? postResponse.data.status : 'success'
  }
} else {
  // Handle errors
  const errorMsg = (postResponse && postResponse.data && postResponse.data.error) ? postResponse.data.error : 'Unknown error'
  output = {
    success: false,
    error: errorMsg,
    status: postResponse ? postResponse.status : 'error'
  }
}
```

## Deployment Requirements

1. **Deploy the Edge Function** (if not already deployed):
   ```bash
   supabase functions deploy highlevel-onboard
   ```

2. **Set Environment Variables** (if not already set):
   ```bash
   supabase secrets set SUPABASE_URL=your_supabase_url
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   supabase secrets set APP_BASE_URL=https://your-app-domain.com
   supabase secrets set APP_LOGIN_URL=https://your-app-domain.com/login
   supabase secrets set LEDGER_API_KEY=your_ledger_api_key
   supabase secrets set ONBOARDING_INVITER_USER_ID=your_user_id
   ```

3. **Disable Supabase JWT Verification for this function** so third-party webhooks can hit it. In the Supabase dashboard, open `Edge Functions → highlevel-onboard → Settings` and turn **Verify JWT** off. Authentication is enforced exclusively by the `LEDGER_API_KEY`, so make sure the secret value above matches what you pass from HighLevel.

**Note**: No database schema changes required - `business_name` is stored in the existing metadata JSONB field.

## Authentication

Requests are authenticated using a Ledger API key sent in the `Authorization` header as a Bearer token. Configure your Ledger API key as an environment variable and pass it from HighLevel as `ledger_api_key`. Because JWT verification is disabled for this function, only requests that include the correct Ledger API key will succeed.

## HighLevel Setup

1. Create a workflow that triggers on successful payments/orders
2. Add a "Custom Code" action block
3. Paste the code above
4. Configure the trigger data mapping based on your HighLevel setup

## Required vs Optional Fields

**REQUIRED (your API will fail without these):**
- `email`: User's email address (must be valid)
- `full_name`: Contact's full name
- `contact_id`: HighLevel contact identifier (used for idempotency to prevent duplicate processing)
- `ledger_api_key`: Ledger API key for authentication

**OPTIONAL (enhances account creation):**
- `business_name`: Business/company name (passed as input data parameter; used as the account name if provided)

**OPTIONAL (stored for tracking but not required):**
- `amount`, `currency`, `payment_id`, etc.: Payment/transaction details
- Any other metadata you want to store

## Testing

Test the integration by:
1. Making a test payment in HighLevel
2. Checking the Supabase function logs
3. Verifying the account was created in your database
4. Confirming the invitation email was sent (if applicable)

## Response Format

Your function returns different responses based on the scenario:

- **New user**: Creates account + sends invitation link
- **Existing user**: Attaches user to account + provides login URL
- **Duplicate**: Returns cached response for idempotent requests

Expected response structure:
```json
{
  "status": "ok" | "existing_user_attached" | "ignored",
  "account_id": "uuid",
  "invitation_link": "https://your-app.com/invite/token", // Only for new users
  "login_url": "https://your-app.com/login" // Only for existing users
}
```