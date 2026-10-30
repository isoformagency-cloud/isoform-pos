// Vercel runs the API as one function. vercel.json sends every /api request here.
import { app } from '../../api/src/app.js'

export default { fetch: app.fetch }
