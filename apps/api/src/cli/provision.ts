// Activates an approved business. Run: npm run provision -w @isoform/api -- ./business.json
import { readFileSync } from 'node:fs'
import { provisionBusiness } from '../modules/tenancy/provision.js'

const file = process.argv[2]
if (!file) throw new Error('Pass the path to a JSON file describing the business.')

const result = await provisionBusiness(JSON.parse(readFileSync(file, 'utf8')))
console.log('Business activated:', result.tenantId)
console.log('Send this private setup link to the owner:', result.setupLink)
