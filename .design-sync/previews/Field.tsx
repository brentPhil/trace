import {
  Field,
  FieldLabel,
  FieldTitle,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldSeparator,
  FieldContent,
  Input,
  Label,
} from 'chroneli';

export function Vertical() {
  return (
    <Field className="w-80">
      <FieldLabel htmlFor="f-v">Entry description</FieldLabel>
      <Input id="f-v" defaultValue="Sprint planning" />
      <FieldDescription>Shown on the invoice line for this entry.</FieldDescription>
    </Field>
  );
}

/* No checkbox here on purpose: this design system does not ship one, and a
 * native <input type="checkbox"> would render the engine's own control -
 * off-palette, and a pattern the design agent should not learn from a card. */
export function Horizontal() {
  return (
    <Field orientation="horizontal" className="w-96">
      <FieldContent>
        <FieldTitle>Rounding increment</FieldTitle>
        <FieldDescription>
          Applied when an entry is exported, never to the tracked total.
        </FieldDescription>
      </FieldContent>
      <Input defaultValue="15" className="w-20" aria-label="Rounding increment" />
    </Field>
  );
}

export function Invalid() {
  return (
    <Field data-invalid className="w-80">
      <FieldLabel htmlFor="f-i">Hourly rate</FieldLabel>
      <Input id="f-i" defaultValue="-40" aria-invalid />
      <FieldError>Rate must be a positive number.</FieldError>
    </Field>
  );
}

export function Grouped() {
  return (
    <FieldSet className="w-96">
      <FieldLegend>Invoice defaults</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="f-g1">Client</FieldLabel>
          <Input id="f-g1" defaultValue="Acme Corp" />
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel htmlFor="f-g2">Hourly rate</FieldLabel>
          <Input id="f-g2" defaultValue="120" />
          <FieldDescription>In your account currency.</FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
