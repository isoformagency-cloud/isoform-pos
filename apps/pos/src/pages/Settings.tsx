import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt, type BillFormat } from '../components/Receipt'
import { Loading, Notice, PageHeader, Segmented } from '../components/ui'
import { api } from '../lib/api'

const SAMPLE_LINES = [
  { id: '1', description: 'Filter coffee', hsn_sac: '', quantity: '2', unit_price: '80.00', discount: '0.00', taxable_value: '160.00', cgst: '4.00', sgst: '4.00', cgst_rate: '2.5', sgst_rate: '2.5' },
  { id: '2', description: 'Masala dosa', hsn_sac: '', quantity: '1', unit_price: '150.00', discount: '0.00', taxable_value: '150.00', cgst: '3.75', sgst: '3.75', cgst_rate: '2.5', sgst_rate: '2.5' },
]

export function Settings() {
  const queryClient = useQueryClient()
  const business = useQuery({ queryKey: ['business'], queryFn: () => api('/business') })
  const registrations = useQuery({ queryKey: ['tax'], queryFn: () => api('/tax-registrations') })
  const me = queryClient.getQueryData<{ permissions: string[] }>(['me'])
  const canWrite = me?.permissions.includes('business.write')
  const [draft, setDraft] = useState<{ footer?: string; fssai?: string; format?: BillFormat; name?: string }>({})
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
      </Loading>
    </>
  )
}
