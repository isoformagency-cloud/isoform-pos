import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip, Plus, ReceiptText, Search } from 'lucide-react'
import type { Me } from '../App'
import { useAsk } from '../components/Ask'
import { ChooseBranch, useWorkingBranch } from '../components/BranchPicker'
import { Badge, Empty, Modal, Notice, PageHeader } from '../components/ui'
import { api, ApiError, supabase } from '../lib/api'
import { downloadCsv, localDate, money, shortDate } from '../lib/format'
import { shrink } from '../lib/photo'

const CATEGORIES: Record<string, string> = {
  ingredients: 'Ingredients', rent: 'Rent', electricity: 'Electricity', salaries: 'Salaries',
  maintenance: 'Maintenance', packaging: 'Packaging', marketing: 'Marketing', other: 'Other',
}
const METHODS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }

function monthStart(monthsAgo = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  return new Date(first.getTime() - first.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

const PERIODS: Record<string, { label: string; range: () => { from?: string; to?: string } }> = {
  month: { label: 'This month', range: () => ({ from: monthStart() }) },
  last: { label: 'Last month', range: () => ({ from: monthStart(1), to: localDate(new Date().getDate()) }) },
  d30: { label: 'Last 30 days', range: () => ({ from: localDate(29) }) },
  d90: { label: 'Last 90 days', range: () => ({ from: localDate(89) }) },
  all: { label: 'All time', range: () => ({}) },
}

async function attachReceipt(id: string, file: File) {
  const blob = await shrink(file)
  const { path, token } = await api(`/expenses/${id}/receipt`, { method: 'POST', branch: true })
  const { error } = await supabase.storage.from('receipts').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error('The expense saved, but the photo could not be uploaded.')
  await api(`/expenses/${id}`, { method: 'PATCH', branch: true, body: { receiptPath: path } })
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="tnum mt-1 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
    </div>
  )
}

export function Expenses({ me }: { me: Me }) {
  const branch = useWorkingBranch(me)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('month')
  const [category, setCategory] = useState('')
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<any | null>(null)
  const canWrite = me.permissions.includes('expenses.write')

  const range = PERIODS[period].range()
  const query = new URLSearchParams(Object.entries({ ...range, ...(category ? { category } : {}), ...(text.trim() ? { q: text.trim() } : {}) })).toString()
  const summaryQuery = new URLSearchParams(Object.entries(range)).toString()
  const list = useQuery({ queryKey: ['expenses', query], queryFn: () => api(`/expenses?${query}`, { branch: true }) })
  const summary = useQuery({ queryKey: ['expenses', 'summary', summaryQuery], queryFn: () => api(`/expenses/summary?${summaryQuery}`, { branch: true }) })
  const rows: any[] = list.data?.items ?? []
  const data = summary.data
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  if (!branch && canWrite && adding) return <ChooseBranch title="Expenses" />

  function exportCsv() {
    downloadCsv(`expenses-${localDate()}.csv`, [
      ['Date', 'Expense', 'Category', 'Paid by', 'Amount', 'Reference', 'Notes', 'Status'],
      ...rows.map((row) => [row.expense_date, row.name, CATEGORIES[row.category], METHODS[row.method], row.amount, row.reference, row.notes, row.status]),
    ])
  }

  const largest = data?.byCategory[0]
  const share = data && Number(data.netSales) > 0 ? `${Math.round((Number(data.total) / Number(data.netSales)) * 100)}%` : '—'

  return (
    <>
      <PageHeader
        title="Expenses"
        text="Rent, salaries, bills and purchases, so you can see real profit."
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary" disabled={rows.length === 0} onClick={exportCsv}><Download size={16} aria-hidden="true" /> Export</button>
            {canWrite && <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Record expense</button>}
          </div>
        )}
      />

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={PERIODS[period].label} value={money(data.total)} note={`${data.entries} ${data.entries === 1 ? 'entry' : 'entries'}`} />
          <Stat label="Largest category" value={largest ? CATEGORIES[largest.category] : '—'} note={largest ? money(largest.total) : undefined} />
          <Stat label="Net sales" value={money(data.netSales)} note="Before tax" />
          <Stat label="Expenses vs sales" value={share} note="Of net sales" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">Search expenses</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input value={text} onChange={(event) => setText(event.target.value)} className="input !min-h-10 !pl-9 !text-sm" placeholder="Search expenses" />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select className="input !min-h-10 !w-auto !text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Period</span>
          <select className="input !min-h-10 !w-auto !text-sm" value={period} onChange={(event) => setPeriod(event.target.value)}>
            {Object.entries(PERIODS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
          </select>
        </label>
      </div>

      {list.error && <Notice>{list.error.message}</Notice>}
      {list.isPending && <p className="py-6 text-sm text-ink-soft">Loading expenses…</p>}
      {list.data && rows.length === 0 && <Empty icon={ReceiptText} title="No expenses in this view" text={canWrite ? 'Record your first expense to start tracking real profit.' : undefined} />}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="data-table min-w-[36rem]">
            <thead><tr><th>Date</th><th>Expense</th><th>Category</th><th>Paid by</th><th className="!text-right">Amount</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-link tabIndex={0} className={row.status === 'voided' ? 'opacity-55' : ''} onClick={() => setPicked(row)} onKeyDown={(event) => { if (event.key === 'Enter') setPicked(row) }}>
                  <td className="whitespace-nowrap">{shortDate(row.expense_date)}</td>
                  <td>
                    <span className={`font-medium ${row.status === 'voided' ? 'line-through' : ''}`}>{row.name}</span>
                    {row.has_receipt && <Paperclip size={13} className="ml-1.5 inline text-ink-faint" aria-label="Has a receipt" />}
                    {row.reference && <span className="block text-xs text-ink-soft">{row.reference}</span>}
                  </td>
                  <td>{CATEGORIES[row.category]}</td>
                  <td>{METHODS[row.method]}{row.from_drawer ? ' · drawer' : ''}</td>
                  <td className="tnum text-right font-medium">{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && branch && <ExpenseForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} />}
      {picked && <ExpenseDetail expense={picked} canWrite={canWrite} onClose={() => setPicked(null)} onChanged={() => { setPicked(null); refresh() }} />}
    </>
  )
}

function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState('upi')
  const [photo, setPhoto] = useState<File | null>(null)
  const [warning, setWarning] = useState('')
  const save = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = crypto.randomUUID()
      await api('/expenses', {
        method: 'POST',
        branch: true,
        body: {
          id, name: form.name, category: form.category, amount: form.amount, expenseDate: form.expenseDate, method,
          reference: form.reference, notes: form.notes, fromDrawer: method === 'cash' && form.fromDrawer === 'on',
        },
      })
      if (photo) await attachReceipt(id, photo).catch((failure) => setWarning(failure.message))
    },
    onSuccess: () => { if (!photo || !warning) onSaved() },
  })

  return (
    <Modal title="Record expense" onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate(Object.fromEntries(new FormData(event.currentTarget)))
        }}
      >
        <label className="field col-span-2">Expense<input name="name" required minLength={2} maxLength={120} placeholder="Monthly rent" /></label>
        <label className="field">
          Category
          <select name="category" defaultValue="ingredients">
            {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">Amount<input name="amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" title="An amount such as 1500 or 1500.50" /></label>
        <label className="field">Date<input name="expenseDate" type="date" required defaultValue={localDate()} max={localDate()} /></label>
        <label className="field">
          Paid by
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            {Object.entries(METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {method === 'cash' && (
          <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="fromDrawer" defaultChecked /> Taken from the cash drawer
          </label>
        )}
        <label className="field">Reference or bill no.<input name="reference" maxLength={80} /></label>
        <label className="field">Notes<input name="notes" maxLength={300} /></label>
        <label className="field col-span-2">
          Receipt photo (optional)
          <input type="file" accept="image/*" capture="environment" className="!min-h-0 !py-2 !text-sm" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
        </label>
        {save.error && (
          <div className="col-span-2">
            <Notice>{save.error.message}{save.error instanceof ApiError && save.error.code === 'no_open_session' ? ' Or untick the drawer box.' : ''}</Notice>
          </div>
        )}
        {warning && <div className="col-span-2"><Notice>{warning}</Notice></div>}
        <button className="btn btn-primary col-span-2" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save expense'}</button>
      </form>
    </Modal>
  )
}

function ExpenseDetail({ expense, canWrite, onClose, onChanged }: { expense: any; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { ask, node } = useAsk()
  const receipt = useQuery({
    queryKey: ['expense-receipt', expense.id],
    queryFn: () => api(`/expenses/${expense.id}/receipt`, { branch: true }),
    enabled: expense.has_receipt,
    staleTime: 240000,
  })
  const act = useMutation({
    mutationFn: (reason: string) => api(`/expenses/${expense.id}/void`, { method: 'POST', branch: true, body: { reason } }),
    onSuccess: onChanged,
  })

  async function voidIt() {
    const answer = await ask('Void this expense?', [{ name: 'reason', label: 'Reason', required: true }], 'Void expense')
    if (answer) act.mutate(answer.reason)
  }

  return (
    <Modal
      side
      title={expense.name}
      text={`${shortDate(expense.expense_date)} · ${CATEGORIES[expense.category]}`}
      onClose={onClose}
      footer={canWrite && expense.status === 'active' ? <button className="btn btn-secondary" disabled={act.isPending} onClick={voidIt}>Void expense</button> : undefined}
    >
      {node}
      <div className="grid gap-4 text-sm">
        {expense.status === 'voided' && <Badge tone="bad">Voided</Badge>}
        <p className="tnum font-display text-3xl font-semibold tracking-tight">{money(expense.amount)}</p>
        <dl className="grid grid-cols-2 gap-3">
          <div><dt className="text-xs text-ink-soft">Paid by</dt><dd>{METHODS[expense.method]}{expense.from_drawer ? ', from the drawer' : ''}</dd></div>
          {expense.reference && <div><dt className="text-xs text-ink-soft">Reference</dt><dd>{expense.reference}</dd></div>}
          {expense.notes && <div className="col-span-2"><dt className="text-xs text-ink-soft">Notes</dt><dd>{expense.notes}</dd></div>}
        </dl>
        {act.error && <Notice>{act.error.message}</Notice>}
        {expense.has_receipt && (
          <section>
            <h3 className="mb-1.5 text-sm">Receipt</h3>
            {receipt.error && <Notice>{receipt.error.message}</Notice>}
            {receipt.data && <img src={receipt.data.url} alt={`Receipt for ${expense.name}`} className="w-full rounded-xl border border-line-soft" />}
          </section>
        )}
      </div>
    </Modal>
  )
}
