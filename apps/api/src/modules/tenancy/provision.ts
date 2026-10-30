import pg from 'pg'
import { supabaseAdmin } from '../../platform/supabase.js'

export interface NewBusiness {
  displayName: string
  legalName: string
  scheme: 'regular' | 'composition' | 'unregistered'
  gstin?: string
  stateCode: string
  address: string
  branchName: string
  branchCode: string
  ownerName: string
  ownerEmail: string
}

const DEFAULT_METHODS = [
  ['Cash', 'cash', false],
  ['UPI', 'upi', false],
  ['Card', 'card', false],
  ['Bank transfer', 'bank_transfer', false],
] as const

/**
 * Activates a business. Runs on ISOFORM's admin connection, never from a tenant request.
 * Returns a password-setup link for the owner.
 */
export async function provisionBusiness(input: NewBusiness) {
  const created = await supabaseAdmin.auth.admin.createUser({ email: input.ownerEmail, email_confirm: true })
  if (created.error) throw new Error(`Could not create owner: ${created.error.message}`)
  const userId = created.data.user.id

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL_DIRECT, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    await db.query('begin')
    const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0].id as string

    const tenantId = await one(
      `insert into app.tenants (display_name, status) values ($1, 'active') returning id`,
      [input.displayName],
    )
    const taxId = await one(
      `insert into app.tax_registrations (tenant_id, legal_name, gstin, state_code, scheme, address)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [tenantId, input.legalName, input.gstin ?? null, input.stateCode, input.scheme, input.address],
    )
    const branchId = await one(
      `insert into app.branches (tenant_id, tax_registration_id, name, code) values ($1, $2, $3, $4) returning id`,
      [tenantId, taxId, input.branchName, input.branchCode],
    )
    const membershipId = await one(
      `insert into app.memberships (tenant_id, user_id, display_name, role) values ($1, $2, $3, 'owner') returning id`,
      [tenantId, userId, input.ownerName],
    )
    await db.query(`insert into app.registers (tenant_id, branch_id, name) values ($1, $2, 'Main')`, [tenantId, branchId])
    for (const [name, kind, requiresReference] of DEFAULT_METHODS) {
      await db.query(
        `insert into app.payment_methods (tenant_id, name, kind, requires_reference) values ($1, $2, $3, $4)`,
        [tenantId, name, kind, requiresReference],
      )
    }
    await db.query('commit')

    const link = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email: input.ownerEmail })
    return { tenantId, branchId, membershipId, userId, setupLink: link.data?.properties?.action_link ?? null }
  } catch (error) {
    await db.query('rollback').catch(() => {})
    await supabaseAdmin.auth.admin.deleteUser(userId)
    throw error
  } finally {
    await db.end()
  }
}
