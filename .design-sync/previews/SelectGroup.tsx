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

/* SelectLabel needs a SelectGroup ancestor - that is what the group is for.
 * alignItemWithTrigger={false} drops the popup below the trigger so the first
 * group label is not clipped off the top edge. */

export function GroupedOptions() {
  return (
    <div className="flex w-64 flex-col gap-2">
      <Label>Project</Label>
      <Select defaultValue="acme-web" open modal={false} items={PROJECTS}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
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
