import { Input, Label, Field, FieldLabel, FieldDescription, FieldError } from 'chroneli';

export function Default() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="i-default">Entry description</Label>
      <Input id="i-default" defaultValue="Invoice export bug" />
    </div>
  );
}

export function Placeholder() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="i-placeholder">Entry description</Label>
      <Input id="i-placeholder" placeholder="What are you working on?" />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="i-disabled">Client</Label>
      <Input id="i-disabled" defaultValue="Acme Corp" disabled />
    </div>
  );
}

export function Invalid() {
  return (
    <Field data-invalid className="w-72">
      <FieldLabel htmlFor="i-invalid">Hourly rate</FieldLabel>
      <Input id="i-invalid" defaultValue="-40" aria-invalid />
      <FieldError>Rate must be a positive number.</FieldError>
    </Field>
  );
}

export function WithDescription() {
  return (
    <Field className="w-72">
      <FieldLabel htmlFor="i-desc">Rounding</FieldLabel>
      <Input id="i-desc" defaultValue="15" />
      <FieldDescription>
        Minutes each entry rounds up to when it lands on an invoice.
      </FieldDescription>
    </Field>
  );
}
