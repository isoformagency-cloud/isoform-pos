export class AppError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} was not found.`)
export const forbidden = () => new AppError(403, 'forbidden', 'You do not have permission to do this.')
