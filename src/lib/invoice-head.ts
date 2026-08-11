import { isTraceError } from "@shared/codes"

/**
 * The invoice head as a FORM — eight values held together, compared, and
 * written in one go.
 *
 * The invoice editor is the one surface in this product that does not save on
 * blur (see the route's own comment for why). That decision needs somewhere for
 * "has anything actually changed?" to live, and it cannot be a touched flag: a
 * user who types over a value and types it back has changed nothing, and a form
 * that called that dirty would light its Save button and then warn about losing
 * edits that do not exist. So dirtiness is a COMPARISON against what the server
 * holds, and this module is that comparison.
 *
 * Pure — no React, no Convex — so the arithmetic of it is asserted directly
 * rather than through a rendered page.
 */

/**
 * The editable head, with every optional column spelled as `""`.
 *
 * `purchaseOrder`, `paymentTerms` and `notes` are ABSENT on the document when
 * unset — `invoices.update` clears the column rather than storing an empty
 * string, so there is one spelling of "not set" in the database. A form field's
 * value is always a string, so there has to be one spelling on this side too,
 * and `""` is it. `headOf` and `headPatch` are the two places the translation
 * happens, which is what stops `undefined` and `""` from being compared to each
 * other somewhere in the middle and reading as a change.
 */
export type InvoiceHead = {
  billedTo: string
  payTo: string
  currency: string
  issuedAt: number
  dueAt: number
  purchaseOrder: string
  paymentTerms: string
  notes: string
}

/** Every field, in the order the form reads top to bottom — which is the order
 *  a collision banner should name them in. */
export const INVOICE_HEAD_FIELDS = [
  "issuedAt",
  "dueAt",
  "purchaseOrder",
  "paymentTerms",
  "billedTo",
  "payTo",
  "currency",
  "notes",
] as const

export type InvoiceHeadField = (typeof INVOICE_HEAD_FIELDS)[number]

/** What a refusal or a collision calls the field, in the words the label beside
 *  it uses. A message pointing at `purchaseOrder` is a message written for the
 *  developer who wrote the validator. */
const LABELS: Record<InvoiceHeadField, string> = {
  issuedAt: "Invoice date",
  dueAt: "Due date",
  purchaseOrder: "Purchase order",
  paymentTerms: "Payment terms",
  billedTo: "Billed to",
  payTo: "Pay to",
  currency: "Currency",
  notes: "Notes",
}

export function invoiceHeadLabel(field: InvoiceHeadField): string {
  return LABELS[field]
}

/** The stored document, as the form holds it. */
export function headOf(invoice: {
  billedTo: string
  payTo: string
  currency: string
  issuedAt: number
  dueAt: number
  purchaseOrder?: string
  paymentTerms?: string
  notes?: string
}): InvoiceHead {
  return {
    billedTo: invoice.billedTo,
    payTo: invoice.payTo,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    purchaseOrder: invoice.purchaseOrder ?? "",
    paymentTerms: invoice.paymentTerms ?? "",
    notes: invoice.notes ?? "",
  }
}

/**
 * One field, as it would be STORED.
 *
 * Every string on this document is trimmed at the ends by `invoices.update`
 * before it is written (never collapsed inside — the newlines are an address's
 * shape). So a trailing space is not an edit: saving it would write a value
 * identical to the one already there, and comparing raw would leave the form
 * permanently dirty after a stray keystroke the user cannot see. Comparing
 * stored-for-stored is the same rule `InlineEdit` and `PartyBlock` apply to a
 * single field, lifted to the form.
 */
function storedValue(head: InvoiceHead, field: InvoiceHeadField): string | number {
  const value = head[field]
  return typeof value === "string" ? value.trim() : value
}

/**
 * The fields on which two heads disagree.
 *
 * ONE function for two questions, because they are the same question asked of
 * different pairs: which fields the user has changed (draft against what is
 * stored), and which fields moved underneath them (the previously stored value
 * against the one a live query just delivered).
 */
export function changedHeadFields(
  a: InvoiceHead,
  b: InvoiceHead
): Array<InvoiceHeadField> {
  return INVOICE_HEAD_FIELDS.filter(
    (field) => storedValue(a, field) !== storedValue(b, field)
  )
}

/**
 * What to send to `invoices.update`: the changed fields and nothing else.
 *
 * Only the changed ones, so a save cannot be refused for a field the user never
 * touched — an invoice created before a bound tightened would otherwise be
 * uneditable, every Save rejected over an address nobody was editing.
 *
 * Trimmed here rather than at the field, so what is compared for dirtiness and
 * what is written are the same value by construction.
 */
export function headPatch(
  draft: InvoiceHead,
  fields: ReadonlyArray<InvoiceHeadField>
): Partial<InvoiceHead> {
  const patch: Partial<InvoiceHead> = {}
  for (const field of fields) {
    // Split by field rather than by `typeof`, because a `Partial<InvoiceHead>`
    // indexed by a union key accepts only the intersection of the value types,
    // and `string | number` is not assignable to `string & number`.
    if (field === "issuedAt" || field === "dueAt") patch[field] = draft[field]
    else patch[field] = draft[field].trim()
  }
  return patch
}

/**
 * Which field a refused Save was about, from the error itself.
 *
 * `invoices.update` puts the field name in `meta.field` (see `HeadField`
 * there) precisely so this does not have to read the sentence. Matching on the
 * prose — "Keep the pay-to block under…" — would work today and break the first
 * time somebody improves the wording, and the failure would be silent: the
 * refusal would simply stop appearing beside the field and reappear as a
 * general one, which is the state this whole mechanism exists to avoid.
 *
 * `null` for anything unrecognised, which is the honest answer for a network
 * failure or a refusal from a Convex version that predates the field.
 */
export function refusedHeadField(error: unknown): InvoiceHeadField | null {
  if (!isTraceError(error)) return null
  const field = error.data.meta?.field
  const known: ReadonlyArray<string> = INVOICE_HEAD_FIELDS
  return typeof field === "string" && known.includes(field)
    ? (field as InvoiceHeadField)
    : null
}

// ---------------------------------------------------------------------------
// The form's state, as a value
// ---------------------------------------------------------------------------

/**
 * Everything the buffered editor holds, and the reason it is four things rather
 * than one.
 *
 * `draft` is what is on screen. The other three exist because a Convex query is
 * LIVE: the stored document can change while somebody is typing into it, and
 * the naive form — one draft compared against whatever the query most recently
 * delivered — gets that wrong in both directions at once.
 */
export type InvoiceHeadForm = {
  /** What is in the controls right now. */
  draft: InvoiceHead
  /**
   * What we believe is STORED, and therefore what `draft` is dirty against.
   *
   * Not simply "the latest query result", because a save is acknowledged before
   * the subscription delivers the new document. For that window the query still
   * answers with the OLD values, and a form comparing against it would call
   * itself dirty a moment after saving — lighting Save again and arming the
   * unsaved-changes guard over an edit that is already written.
   */
  committed: InvoiceHead
  /**
   * The last server value RECONCILED against — the tripwire, not the truth.
   *
   * `committed` cannot serve as this: right after a save the two deliberately
   * disagree, and reconciling on that disagreement would pull the just-saved
   * values back out of the draft.
   */
  seen: InvoiceHead
  /** Fields the server moved while the user had unsaved edits in them. */
  collided: Array<InvoiceHeadField>
}

export function seedHeadForm(server: InvoiceHead): InvoiceHeadForm {
  return { draft: server, committed: server, seen: server, collided: [] }
}

/**
 * A keystroke — and the one piece of bookkeeping that has to happen on it.
 *
 * `collided` is a record of what the SERVER did, so nothing the user types can
 * add to it. But a collision can be SETTLED by typing: the field disagreed,
 * the user typed their copy back into agreement with what arrived, and there is
 * no longer a disagreement for the banner to be about. Leaving the entry in
 * place made that banner resurface on the next keystroke into that field — a
 * warning about a push that happened minutes ago and was already answered, with
 * nothing having arrived since. A warning that reappears for no reason is the
 * one people learn to ignore.
 *
 * Dropped HERE rather than filtered at read time, because "has this field ever
 * agreed since it collided?" is history, and only the transition that makes it
 * true can see it.
 */
export function editHeadForm(
  form: InvoiceHeadForm,
  patch: Partial<InvoiceHead>
): InvoiceHeadForm {
  const draft = { ...form.draft, ...patch }
  const dirty = new Set(changedHeadFields(draft, form.committed))
  return { ...form, draft, collided: form.collided.filter((field) => dirty.has(field)) }
}

/** Copies one field across, split by field because a `Partial<InvoiceHead>`
 *  indexed by a union key accepts only `string & number`. */
function copyField(into: InvoiceHead, from: InvoiceHead, field: InvoiceHeadField): void {
  if (field === "issuedAt" || field === "dueAt") into[field] = from[field]
  else into[field] = from[field]
}

/**
 * A new server document arrives mid-edit. What happens to the draft?
 *
 * THE ARGUMENT, because neither obvious answer is acceptable and this is the
 * decision the whole buffered form turns on.
 *
 * Taking the server's values wholesale deletes what somebody is in the middle of
 * typing. `PartyBlock` used to guard exactly this at field level — it re-seeded
 * from the server only while the textarea was unfocused, because blur was the
 * only commit and "not focused" was therefore exactly "not mid-edit". Buffering
 * broke that guard rather than removing the problem: every field is now mid-edit
 * from the first keystroke until Save, focused or not, so a focus check would
 * protect one field and quietly overwrite the other seven.
 *
 * Ignoring the change is no better. The form would go on showing a stale value,
 * Save would write the draft straight over the newer document, and the user
 * would never learn that anything had happened — a silent last-writer-wins on a
 * document that gets sent to clients.
 *
 * So: PER FIELD, and only the touched ones are contentious.
 *
 *   - A field the user has NOT touched adopts the server's value silently.
 *     There is nothing to lose, and refusing to move it would leave a page
 *     showing two different versions of one document.
 *   - A field the user HAS touched keeps what they typed and is recorded in
 *     `collided`. The editor names those fields and offers to drop its own
 *     copy. Their unsaved text is never thrown away by something they did not
 *     do; what they are denied is only the silence.
 *
 * `committed` follows the server for every moved field either way — the server
 * IS what is stored, so dirtiness has to be measured against it. That is what
 * makes a collision self-resolving: if the value that arrived happens to equal
 * what the user typed, the field stops being dirty and the collision stops being
 * reported, because there is no longer a disagreement to report.
 */
export function reconcileHeadForm(
  form: InvoiceHeadForm,
  server: InvoiceHead
): InvoiceHeadForm {
  const moved = changedHeadFields(form.seen, server)
  if (moved.length === 0) return form

  const draft = { ...form.draft }
  const committed = { ...form.committed }
  const collided = new Set(form.collided)
  const touched = new Set(changedHeadFields(form.draft, form.committed))

  for (const field of moved) {
    if (touched.has(field)) collided.add(field)
    else copyField(draft, server, field)
    copyField(committed, server, field)
  }

  return {
    draft,
    committed,
    seen: server,
    // Reading order, so a banner names them the way the page does — and
    // deduplicated by construction, because a field can collide twice.
    collided: INVOICE_HEAD_FIELDS.filter((field) => collided.has(field)),
  }
}

/** The Save landed. What was sent is now what is stored, and any collision on
 *  those fields is settled — the user chose their own copy and it won. */
export function commitHeadForm(
  form: InvoiceHeadForm,
  fields: ReadonlyArray<InvoiceHeadField>
): InvoiceHeadForm {
  return {
    ...form,
    committed: { ...form.committed, ...headPatch(form.draft, fields) },
    collided: form.collided.filter((field) => !fields.includes(field)),
  }
}

/** The fields whose collision is still live — the server moved them AND the
 *  draft still disagrees. A field the user then typed back into agreement has
 *  nothing left to warn about. */
export function liveCollisions(form: InvoiceHeadForm): Array<InvoiceHeadField> {
  const dirty = new Set(changedHeadFields(form.draft, form.committed))
  return form.collided.filter((field) => dirty.has(field))
}

/**
 * "Use the newer version" — and it discards EXACTLY what the banner named.
 *
 * The obvious spelling is `draft = committed`, and it is wrong in a way nothing
 * on screen reveals. `committed` is the whole head, so that assignment reverts
 * all eight fields; the banner beside the button names only the collided ones.
 * A user who had typed into Billed to and into Notes, and is told that Billed to
 * moved elsewhere, loses the Notes paragraph too — unnamed, unrecoverable, and
 * with the form now CLEAN, so the unsaved-changes guard says nothing on the way
 * out either. On the one page built around "an edit can be lost, so protect it",
 * the single button that discards must discard only what it advertised.
 *
 * `liveCollisions` rather than `collided`, so this drops exactly the set the
 * banner listed: a collision the user already typed back into agreement is not
 * named there and has nothing left to take.
 *
 * `collided` is emptied outright. The offer was answered — the entries that were
 * still live have just been reverted, and any that were not were already settled.
 */
export function takeNewerHeadForm(form: InvoiceHeadForm): InvoiceHeadForm {
  const draft = { ...form.draft }
  for (const field of liveCollisions(form)) copyField(draft, form.committed, field)
  return { ...form, draft, collided: [] }
}

/**
 * "Billed to and Notes", "Billed to, Pay to and Notes" — a list a sentence can
 * contain.
 *
 * Named rather than counted, because "3 fields have unsaved changes" tells
 * somebody deciding whether to discard them exactly nothing they can decide on.
 */
export function nameFields(fields: ReadonlyArray<InvoiceHeadField>): string {
  const names = fields.map(invoiceHeadLabel)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
