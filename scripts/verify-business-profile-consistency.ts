#!/usr/bin/env tsx
/**
 * Verification script for business profile consistency
 * 
 * Phase 4: Run this script to verify that business_profiles and accounts tables are in sync.
 * Can be run manually or scheduled as a cron job.
 * 
 * Usage:
 *   npx tsx scripts/verify-business-profile-consistency.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function verifyConsistency() {
  console.log('🔍 Checking business profile consistency...\n')

  try {
    // Get summary statistics
    const { data: summary, error: summaryError } = await supabase.rpc(
      'get_business_profile_consistency_summary'
    )

    if (summaryError) {
      console.error('Error fetching summary:', summaryError)
      process.exit(1)
    }

    if (!summary || summary.length === 0) {
      console.error('No summary data returned')
      process.exit(1)
    }

    const stats = summary[0]
    console.log('📊 Summary Statistics:')
    console.log(`   Total accounts: ${stats.total_accounts}`)
    console.log(`   Accounts with business_name: ${stats.accounts_with_business_name}`)
    console.log(`   Accounts with business_logo: ${stats.accounts_with_business_logo}`)
    console.log(`   Business profiles count: ${stats.profiles_count}`)
    console.log(`   Total mismatches: ${stats.mismatches_count}`)
    console.log(`   Missing in profiles: ${stats.missing_in_profiles_count}`)
    console.log(`   Missing in accounts: ${stats.missing_in_accounts_count}`)
    console.log()

    // Get detailed inconsistencies
    const { data: inconsistencies, error: inconsistenciesError } = await supabase.rpc(
      'verify_business_profile_consistency'
    )

    if (inconsistenciesError) {
      console.error('Error fetching inconsistencies:', inconsistenciesError)
      process.exit(1)
    }

    if (!inconsistencies || inconsistencies.length === 0) {
      console.log('✅ No inconsistencies found! Tables are in sync.')
      process.exit(0)
    }

    console.log(`⚠️  Found ${inconsistencies.length} inconsistency(ies):\n`)
    
    inconsistencies.forEach((issue: any, index: number) => {
      console.log(`${index + 1}. Account: ${issue.account_id}`)
      console.log(`   Issue: ${issue.issue_type}`)
      if (issue.accounts_business_name !== issue.profiles_name) {
        console.log(`   Name mismatch:`)
        console.log(`     accounts.business_name: ${issue.accounts_business_name || '(null)'}`)
        console.log(`     business_profiles.name: ${issue.profiles_name || '(null)'}`)
      }
      if (issue.accounts_logo_url !== issue.profiles_logo_url) {
        console.log(`   Logo mismatch:`)
        console.log(`     accounts.business_logo_url: ${issue.accounts_logo_url || '(null)'}`)
        console.log(`     business_profiles.logo_url: ${issue.profiles_logo_url || '(null)'}`)
      }
      if (issue.accounts_version !== issue.profiles_version) {
        console.log(`   Version mismatch:`)
        console.log(`     accounts.business_profile_version: ${issue.accounts_version || '(null)'}`)
        console.log(`     business_profiles.version: ${issue.profiles_version || '(null)'}`)
      }
      console.log()
    })

    console.log('❌ Consistency check failed. Please investigate and fix inconsistencies.')
    process.exit(1)
  } catch (error) {
    console.error('Unexpected error:', error)
    process.exit(1)
  }
}

// Run the verification
verifyConsistency()
