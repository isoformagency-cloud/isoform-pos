/** Display only. Money is always calculated on the server. */
export const money = (value: string | number) => {
  const amount = Number(value)
  const whole = Number.isInteger(amount)
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

export const time = (value: string) => new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

export const shortDate = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export const dateTime = (value: string) => `${shortDate(value)}, ${time(value)}`

/** A plain-language age for orders left open, because numbers restart each day. */
export function isOlderDay(value: string) {
  return new Date(value).toDateString() !== new Date().toDateString()
}

export function localDate(daysAgo = 0) {
  const now = new Date(Date.now() - daysAgo * 86400000)
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Cells starting with these would run as formulas when opened in a spreadsheet. */
const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export function downloadCsv(name: string, rows: unknown[][]) {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}
