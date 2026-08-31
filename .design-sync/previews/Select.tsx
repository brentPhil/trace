import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  Label,
} from 'chroneli';

const PROJECTS = [
  { value: 'acme-web', label: 'Acme - Website rebuild' },
  { value: 'acme-app', label: 'Acme - Mobile app' },
  { value: 'internal', label: 'Internal - Admin' },
];

export function Open() {
  return (
    <div className="flex w-64 flex-col gap-2">
      <Label>Project</Label>
      <Select defaultValue="acme-web" open modal={false} items={PROJECTS}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        {/* alignItemWithTrigger={false} drops the popup BELOW the trigger.
            The default (true) aligns the selected row over the trigger, which
            covers it and clips the first group's label off the top edge. */}
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectLabel>Acme Corp</SelectLabel>
            <SelectItem value="acme-web">Website rebuild</SelectItem>
            <SelectItem value="acme-app">Mobile app</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Internal</SelectLabel>
            <SelectItem value="internal">Admin</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export function Closed() {
  return (
    <div className="flex w-64 flex-col gap-2">
      <Label>Project</Label>
      <Select defaultValue="acme-web" items={PROJECTS}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECTS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex w-64 flex-col gap-2">
      <Label>Project</Label>
      <Select defaultValue="acme-web" disabled items={PROJECTS}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROJECTS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
