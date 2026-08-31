import { Label, Input } from 'chroneli';

export function Default() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="l-default">Entry description</Label>
      <Input id="l-default" defaultValue="Design review" />
    </div>
  );
}

export function WithDisabledControl() {
  return (
    <div className="flex w-72 flex-col gap-2">
      <Label htmlFor="l-disabled">Client</Label>
      <Input id="l-disabled" defaultValue="Acme Corp" disabled />
    </div>
  );
}

export function Horizontal() {
  return (
    <div className="flex w-80 items-center gap-3">
      <Label htmlFor="l-horizontal" className="w-24 shrink-0">
        Hourly rate
      </Label>
      <Input id="l-horizontal" defaultValue="120" />
    </div>
  );
}
