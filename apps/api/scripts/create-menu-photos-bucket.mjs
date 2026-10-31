// Creates the public store for menu photos, which the POS shows on every till. Safe to run again.
// Run: node --env-file=../../.env.local scripts/create-menu-photos-bucket.mjs
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const options = { public: true, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] }
const { error } = await admin.storage.createBucket('menu-photos', options)
if (error && !/already exists/i.test(error.message)) throw error
const { data } = await admin.storage.getBucket('menu-photos')
console.log('menu-photos bucket', data?.public === true ? 'public' : 'CHECK: not public')
