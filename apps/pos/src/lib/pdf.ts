const TITLES: Record<string, string> = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply' }
const isZero = (value: string) => Number(value) === 0

/** The built-in PDF fonts have no rupee sign, so bills read "Rs." here. */
export async function downloadBillPdf(bill: any) {
  // Loaded on demand, because most cashiers print and never open it.
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const seller = bill.seller_snapshot
  const left = 15
  const right = 195
  let y = 18

  const line = (text: string, x = left, align: 'left' | 'right' = 'left') => {
    pdf.text(text, x, y, { align })
    y += 5
  }

  pdf.setFont('helvetica', 'bold').setFontSize(15)
  line(seller.tradeName ?? seller.legalName)
  pdf.setFont('helvetica', 'normal').setFontSize(10)
  for (const text of [seller.branchName, seller.branchAddress ?? seller.address, seller.gstin && `GSTIN ${seller.gstin}`, seller.fssai && `FSSAI ${seller.fssai}`]) {
    if (text) line(pdf.splitTextToSize(text, 110)[0])
  }

  const after = y
  y = 18
  pdf.setFont('helvetica', 'bold').setFontSize(13)
  line(seller.scheme === 'unregistered' ? 'Bill' : TITLES[bill.document_type], right, 'right')
  pdf.setFont('helvetica', 'normal').setFontSize(10)
  line(`No. ${bill.number}`, right, 'right')
  line(`Date ${bill.invoice_date}`, right, 'right')
  y = Math.max(after, y) + 2

  if (bill.customer_name) line(`Billed to: ${bill.customer_name}${bill.customer_phone ? `, ${bill.customer_phone}` : ''}`)
  if (bill.delivery_address) line(pdf.splitTextToSize(`Deliver to: ${bill.delivery_address}`, right - left)[0])

  y += 2
  pdf.line(left, y, right, y)
  y += 5
  pdf.setFont('helvetica', 'bold').setFontSize(9)
  const columns: [string, number, 'left' | 'right'][] = [['Item', left, 'left'], ['Qty', 115, 'right'], ['Rate', 135, 'right'], ['Discount', 155, 'right'], ['Taxable', right, 'right']]
  for (const [label, x, align] of columns) pdf.text(label, x, y, { align })
  y += 2
  pdf.line(left, y, right, y)
  y += 5
  pdf.setFont('helvetica', 'normal')

  for (const row of bill.lines) {
    const name: string[] = pdf.splitTextToSize(row.description, 90)
    pdf.text(name, left, y)
    pdf.text(String(Number(row.quantity)), 115, y, { align: 'right' })
    pdf.text(row.unit_price, 135, y, { align: 'right' })
    if (!isZero(row.discount)) pdf.text(row.discount, 155, y, { align: 'right' })
    pdf.text(row.taxable_value, right, y, { align: 'right' })
    y += 4.5 * name.length + 1
    if (row.hsn_sac) {
      pdf.setFontSize(8).text(`HSN/SAC ${row.hsn_sac}`, left, y - 1)
      pdf.setFontSize(9)
      y += 3
    }
    if (y > 260) {
      pdf.addPage()
      y = 18
    }
  }

  y += 1
  pdf.line(left, y, right, y)
  y += 6
  pdf.setFontSize(10)
  const totals = [
    ['Taxable value', bill.taxable_total], ['CGST', bill.cgst_total], ['SGST', bill.sgst_total],
    ['IGST', bill.igst_total], ['Cess', bill.cess_total], ['Round off', bill.round_off],
  ].filter(([, value], index) => index === 0 || !isZero(value))
  for (const [label, value] of totals) {
    pdf.text(label, 140, y)
    pdf.text(value, right, y, { align: 'right' })
    y += 5
  }
  pdf.setFont('helvetica', 'bold').setFontSize(12)
  pdf.text('Total', 140, y + 1)
  pdf.text(`Rs. ${bill.grand_total}`, right, y + 1, { align: 'right' })
  y += 10

  pdf.setFont('helvetica', 'normal').setFontSize(9)
  if (seller.scheme === 'composition') line('Composition taxable person, not eligible to collect tax on supplies.')
  if (seller.footer) line(seller.footer, 105 - pdf.getTextWidth(seller.footer) / 2)

  pdf.save(`${bill.number}.pdf`)
}
