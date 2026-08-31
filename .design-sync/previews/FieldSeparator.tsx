import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field,
  FieldLabel,
  FieldSeparator,
  FieldDescription,
  Input,
} from 'chroneli';

export function BetweenFields() {
  return (
    <FieldSet className="w-96">
      <FieldLegend>Invoice defaults</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="fs-client">Client</FieldLabel>
          <Input id="fs-client" defaultValue="Acme Corp" />
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel htmlFor="fs-rate">Hourly rate</FieldLabel>
          <Input id="fs-rate" defaultValue="120" />
          <FieldDescription>In your account currency.</FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
