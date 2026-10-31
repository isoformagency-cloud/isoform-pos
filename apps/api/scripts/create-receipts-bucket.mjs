// Creates the private store for expense receipts. Safe to run again.
// Run: node --env-file=../../.env.local scripts/create-receipts-bucket.mjs
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const options = { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] }
const { error } = await admin.storage.createBucket('receipts', options)
if (error && !/already exists/i.test(error.message)) throw error
const { data } = await admin.storage.getBucket('receipts')
console.log('receipts bucket', data?.public === false ? 'private' : 'CHECK: not private')
