export const OUTLET_OPTIONS = ['1', '2 to 5', '6 or more'] as const

export interface DemoRequest {
  name: string
  business: string
  phone: string
  email: string
  city: string
  outlets: string
  message: string
}

export type DemoRequestErrors = Partial<Record<keyof DemoRequest, string>>

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function validateDemoRequest(input: unknown): { value: DemoRequest; errors: DemoRequestErrors } {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const phone = text(source.phone).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '')
  const value: DemoRequest = {
    name: text(source.name),
    business: text(source.business),
    phone,
    email: text(source.email).toLowerCase(),
    city: text(source.city),
    outlets: text(source.outlets),
    message: text(source.message),
  }

  const errors: DemoRequestErrors = {}
  if (value.name.length < 2 || value.name.length > 100) errors.name = 'Enter your name.'
  if (value.business.length < 2 || value.business.length > 120) errors.business = 'Enter your business name.'
  if (!/^[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a 10-digit Indian mobile number.'
  if (value.email && (value.email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) {
    errors.email = 'Enter a valid email address, or leave this blank.'
  }
  if (value.city.length < 2 || value.city.length > 80) errors.city = 'Enter your city.'
  if (!OUTLET_OPTIONS.includes(value.outlets as (typeof OUTLET_OPTIONS)[number])) {
    errors.outlets = 'Choose how many outlets you run.'
  }
  if (value.message.length > 1000) errors.message = 'Please keep this under 1,000 characters.'

  return { value, errors }
}
