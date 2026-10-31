import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAsk } from '../components/Ask'
import { ORDER_TYPES } from '../components/order-look'
import { Receipt, type BillFormat } from '../components/Receipt'
import { Loading, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'
import { localDate } from '../lib/format'

const SAMPLE_LINES = [
  { id: '1', description: 'Filter coffee', hsn_sac: '', quantity: '2', unit_price: '80.00', discount: '0.00', taxable_value: '160.00', cgst: '4.00', sgst: '4.00', cgst_rate: '2.5', sgst_rate: '2.5' },
  { id: '2', description: 'Masala dosa', hsn_sac: '', quantity: '1', unit_price: '150.00', discount: '0.00', taxable_value: '150.00', cgst: '3.75', sgst: '3.75', cgst_rate: '2.5', sgst_rate: '2.5' },
]

const ALERTS: [string, string][] = [
  ['lowStock', 'Low or out-of-stock ingredients'],
  ['kitchenDelayed', 'Delayed kitchen tickets'],
  ['paymentIssues', 'Failed payments and short cash'],
  ['paymentsToVerify', 'Payments to confirm'],
  ['unpaidBills', 'Unpaid bills'],
  ['heldOrders', 'Orders on hold'],
  ['leftoverOrders', 'Orders left open from an earlier day'],
]

function PaymentMethods({ canWrite }: { canWrite?: boolean }) {
  const queryClient = useQueryClient()
  const methods = useQuery({ queryKey: ['payment-methods-all'], queryFn: () => api('/payment-methods/all') })
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api(`/payment-methods/${id}`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-methods-all'] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
    },
  })
  return (
    <section className="card grid gap-2 p-5">
      <h2 className="text-lg">Payment methods</h2>
      <p className="hint">Methods turned off disappear from checkout. Past payments stay as they are.</p>
      {methods.data?.items.map((method: any) => (
        <label key={method.id} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={method.is_active}
            disabled={!canWrite || toggle.isPending}
            onChange={(event) => toggle.mutate({ id: method.id, isActive: event.target.checked })}
          />
          {method.name}
        </label>
      ))}
      {toggle.error && <Notice>{toggle.error.message}</Notice>}
    </section>
  )
}

function SampleData() {
  const queryClient = useQueryClient()
  const { ask, node } = useAsk()
  const status = useQuery({ queryKey: ['setup'], queryFn: () => api('/setup') })
  const run = useMutation({
    mutationFn: ({ path, body = {} }: { path: string; body?: object }) => api(path, { method: 'POST', body }),
    onSuccess: () => {
      for (const key of ['setup', 'menu', 'floor']) queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
  const data = status.data
  // A running café with no samples and the guide showing has nothing to do here.
  if (!data || (!data.sample && data.menu && !data.dismissed)) return null
  return (
    <section className="card grid gap-3 p-5">
      {node}
      <h2 className="text-lg">Setup</h2>
      {data?.sample && (
        <>
          <p className="text-sm text-ink-soft">Your menu has sample items. Clearing them hides the sample menu and tables. Bills are never sampled, so your bill numbers aren’t affected.</p>
          <button
            className="btn btn-secondary justify-self-start"
            disabled={run.isPending}
            onClick={async () => (await ask('Clear the sample menu and tables?', [], 'Clear')) && run.mutate({ path: '/setup/sample/clear' })}
          >
            Clear sample data
          </button>
        </>
      )}
      {data && !data.sample && !data.menu && (
        <>
          <p className="text-sm text-ink-soft">Add a sample café menu and tables to look around. You can clear them at any time.</p>
          <button className="btn btn-secondary justify-self-start" disabled={run.isPending} onClick={() => run.mutate({ path: '/setup/sample' })}>Add sample data</button>
        </>
      )}
      {data?.dismissed && <button className="btn btn-secondary justify-self-start" disabled={run.isPending} onClick={() => run.mutate({ path: '/setup/dismiss', body: { dismissed: false } })}>Show the setup guide again</button>}
      {run.error && <Notice>{run.error.message}</Notice>}
    </section>
  )
}

function Backup() {
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function download() {
    setError('')
    try {
      const { sections } = await api('/backup')
      const backup: Record<string, unknown[]> = {}
      for (const [index, section] of (sections as string[]).entries()) {
        setProgress(`Collecting ${index + 1} of ${sections.length}…`)
        backup[section] = []
        for (let offset: number | null = 0; offset !== null;) {
          const page: { rows: unknown[]; nextOffset: number | null } = await api(`/backup/${section}?offset=${offset}`)
          backup[section].push(...page.rows)
          offset = page.nextOffset
        }
      }
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([JSON.stringify({ takenAt: new Date().toISOString(), ...backup }, null, 1)], { type: 'application/json' }))
      link.download = `isoform-backup-${localDate()}.json`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (failure) {
      setError((failure as Error).message)
    }
    setProgress(null)
  }

  return (
    <section className="card grid gap-3 p-5">
      <h2 className="text-lg">Backup</h2>
      <p className="text-sm text-ink-soft">Download your menu, customers, orders, bills, payments, expenses and stock as one file. Keep it safe, because it holds customer details. PINs and passwords are never included.</p>
      <button className="btn btn-secondary justify-self-start" disabled={progress !== null} onClick={download}>{progress ?? 'Download backup'}</button>
      {error && <Notice>{error}</Notice>}
    </section>
  )
}

export function Settings() {
  const queryClient = useQueryClient()
  const business = useQuery({ queryKey: ['business'], queryFn: () => api('/business') })
  const registrations = useQuery({ queryKey: ['tax'], queryFn: () => api('/tax-registrations') })
  const me = queryClient.getQueryData<{ permissions: string[] }>(['me'])
  const canWrite = me?.permissions.includes('business.write')
  const canBackup = me?.permissions.includes('backup.download')
  const [draft, setDraft] = useState<{ footer?: string; fssai?: string; format?: BillFormat; name?: string }>({})
  const [noTypes, setNoTypes] = useState(false)
  const save = useMutation({
    mutationFn: (body: object) => api('/business', { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business'] })
      queryClient.invalidateQueries({ queryKey: ['pos-settings'] })
    },
  })

  const data = business.data
  const registration = registrations.data?.items[0]
  const format = draft.format ?? data?.bill_format ?? 'thermal'
  const charged = registration?.scheme === 'regular'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const orderTypes = form.getAll('orderTypes')
    setNoTypes(orderTypes.length === 0)
    if (orderTypes.length === 0) return
    save.mutate({
      displayName: form.get('displayName'),
      roundingRule: form.get('roundingRule'),
      pricesIncludeTax: form.get('pricesIncludeTax') === 'on',
      allowSelfVerification: form.get('requireSecondPerson') !== 'on',
      upiId: String(form.get('upiId')).trim(),
      fssaiNumber: String(form.get('fssaiNumber')).trim(),
      billFooter: String(form.get('billFooter')).trim(),
      billFormat: format,
      discountPresets: String(form.get('discountPresets')).split(',').map((value) => Number(value.trim())).filter((value) => value > 0),
      cashierDiscountLimit: Number(form.get('cashierDiscountLimit')),
      usesKitchen: form.get('usesKitchen') === 'on',
      kitchenDelayMinutes: Number(form.get('kitchenDelayMinutes')),
      orderTypes,
      defaultSeats: Number(form.get('defaultSeats')),
      showItemPhotos: form.get('showItemPhotos') === 'on',
      showFoodMarks: form.get('showFoodMarks') === 'on',
      mutedAlerts: ALERTS.map(([key]) => key).filter((key) => !form.getAll('alerts').includes(key)),
    })
  }

  const preview = data && {
    number: 'MN-2627-000123',
    document_type: registration?.scheme === 'regular' ? 'tax_invoice' : 'bill_of_supply',
    invoice_date: new Date().toISOString().slice(0, 10),
    customer_name: null,
    seller_snapshot: {
      tradeName: draft.name ?? data.display_name,
      legalName: registration?.legal_name,
      gstin: registration?.gstin,
      stateCode: registration?.state_code,
      scheme: registration?.scheme ?? 'unregistered',
      branchName: 'Main',
      address: 'Your address',
      fssai: draft.fssai ?? data.fssai_number,
      footer: draft.footer ?? data.bill_footer,
    },
    lines: charged ? SAMPLE_LINES : SAMPLE_LINES.map((line) => ({ ...line, cgst: '0.00', sgst: '0.00' })),
    taxable_total: '310.00', cgst_total: charged ? '7.75' : '0.00', sgst_total: charged ? '7.75' : '0.00', igst_total: '0.00', cess_total: '0.00',
    round_off: charged ? '-0.50' : '0.00', grand_total: charged ? '325.00' : '310.00',
    creditNotes: [],
  }

  return (
    <>
      <PageHeader title="Settings" text="Business details, bills, payments and discounts." />
      <Loading ready={!business.isPending} error={business.error}>
        <form onSubmit={submit} className="grid items-start gap-5 xl:grid-cols-[1fr_24rem]">
          <fieldset disabled={!canWrite} className="grid min-w-0 gap-5">
            <section className="card grid gap-4 p-5">
              <h2 className="text-lg">Business</h2>
              <label className="field">
                Business name
                <input name="displayName" defaultValue={data?.display_name} required minLength={2} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
            </section>

            <section className="card grid gap-4 p-5">
              <h2 className="text-lg">Billing and tax</h2>
              <label className="field">
                GSTIN
                <input value={registration?.gstin ?? 'Not registered'} readOnly disabled />
                <span className="hint">Set when your business was activated. It can’t be changed here because it’s printed on legal bills.</span>
              </label>
              <label className="field">
                FSSAI licence number
                <input name="fssaiNumber" inputMode="numeric" pattern="\d{14}" title="14 digits" defaultValue={data?.fssai_number ?? ''} onChange={(event) => setDraft({ ...draft, fssai: event.target.value })} />
              </label>
              <label className="field">
                Bill footer
                <input name="billFooter" maxLength={200} defaultValue={data?.bill_footer ?? ''} placeholder="Thank you, see you again soon" onChange={(event) => setDraft({ ...draft, footer: event.target.value })} />
              </label>
              <div className="field">
                Default bill size
                <div>
                  <Segmented label="Default bill size" value={format} options={[{ value: 'thermal', label: '80mm receipt' }, { value: 'a4', label: 'A4 page' }]} onChange={(value) => setDraft({ ...draft, format: value as BillFormat })} />
                </div>
              </div>
              <label className="field">
                Rounding
                <select name="roundingRule" defaultValue={data?.rounding_rule}>
                  <option value="nearest_rupee">Nearest rupee</option>
                  <option value="none">No rounding</option>
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="pricesIncludeTax" defaultChecked={data?.prices_include_tax} />
                Menu prices include tax
              </label>
              <p className="hint">Bill numbers use your branch code. They can’t be changed, because a GST series must stay in sequence.</p>
            </section>

            <section className="card grid gap-4 p-5">
              <h2 className="text-lg">Payments and discounts</h2>
              <label className="field">
                UPI ID
                <input name="upiId" defaultValue={data?.upi_id ?? ''} placeholder="yourcafe@okbank" autoComplete="off" />
                <span className="hint">Shows a QR code at checkout. Customers pay you directly.</span>
              </label>
              <label className="field">
                Quick discount buttons (%)
                <input name="discountPresets" defaultValue={data?.discount_presets?.join(', ')} placeholder="5, 10, 15" />
                <span className="hint">Separate them with commas. Six at most.</span>
              </label>
              <label className="field">
                Cashier discount limit (%)
                <input name="cashierDiscountLimit" type="number" min={0} max={100} step="0.5" defaultValue={Number(data?.cashier_discount_limit ?? 20)} required />
                <span className="hint">Managers and owners have no limit. Use 0 to stop cashiers giving discounts.</span>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="requireSecondPerson" defaultChecked={!data?.allow_self_verification} />
                Require a second person to confirm payments and review cash
              </label>
            </section>

            <section className="card grid gap-4 p-5">
              <h2 className="text-lg">Kitchen</h2>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="usesKitchen" defaultChecked={data?.uses_kitchen} />
                Use the kitchen display
              </label>
              <p className="hint">Turn this off if you don’t prepare orders from a screen. Send to kitchen and the Kitchen page then disappear.</p>
              <label className="field">
                Mark tickets as delayed after (minutes)
                <input name="kitchenDelayMinutes" type="number" min={1} max={240} defaultValue={data?.kitchen_delay_minutes ?? 15} required />
              </label>
            </section>

            <section className="card grid gap-2 p-5">
              <h2 className="text-lg">Orders and POS</h2>
              <div className="field">
                Order types you offer
                <div className="flex flex-wrap gap-x-5">
                  {ORDER_TYPES.map(([value, label]) => (
                    <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-normal">
                      <input key={String(data?.order_types.includes(value))} type="checkbox" name="orderTypes" value={value} defaultChecked={data?.order_types.includes(value)} />
                      {label}
                    </label>
                  ))}
                </div>
                {noTypes && <Notice>Keep at least one order type turned on.</Notice>}
              </div>
              <label className="field">
                Seats on a new table
                <input name="defaultSeats" type="number" min={1} max={100} defaultValue={data?.default_seats ?? 4} required />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="showItemPhotos" defaultChecked={data?.show_item_photos} />
                Show item photos in the POS
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="showFoodMarks" defaultChecked={data?.show_food_marks} />
                Show veg and non-veg marks in the POS
              </label>
            </section>

            <section className="card grid gap-1 p-5">
              <h2 className="text-lg">Notifications</h2>
              <p className="hint mb-1">Choose what appears on the bell for your whole team.</p>
              {ALERTS.map(([key, label]) => (
                <label key={key} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" name="alerts" value={key} defaultChecked={!data?.muted_alerts.includes(key)} />
                  {label}
                </label>
              ))}
            </section>

            {save.error && <Notice>{save.error.message}</Notice>}
            {save.isSuccess && <Notice tone="ok">Saved.</Notice>}
            {canWrite && <button className="btn btn-primary justify-self-start" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</button>}
          </fieldset>

          {preview && (
            <aside className="min-w-0 xl:sticky xl:top-20">
              <h2 className="mb-2 text-sm text-ink-soft">Live preview, with sample items</h2>
              <div className={format === 'a4' ? 'origin-top-left overflow-x-auto' : ''}>
                <Receipt bill={preview} format={format} />
              </div>
            </aside>
          )}
        </form>
        <div className="mt-5 grid max-w-3xl gap-5">
          <PaymentMethods canWrite={canWrite} />
          {canWrite && <SampleData />}
          {canBackup && <Backup />}
        </div>
      </Loading>
    </>
  )
}
