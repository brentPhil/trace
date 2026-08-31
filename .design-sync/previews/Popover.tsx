import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  Button,
  Field,
  FieldLabel,
  Input,
} from 'chroneli';

export function Open() {
  return (
    <Popover open modal={false}>
      <PopoverTrigger render={<Button variant="outline">09:15 - 10:45</Button>} />
      <PopoverContent className="w-72">
        <PopoverHeader>
          <PopoverTitle>Edit times</PopoverTitle>
          <PopoverDescription>
            Changing the end time re-derives the duration.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex gap-2">
          <Field>
            <FieldLabel htmlFor="p-start">Start</FieldLabel>
            <Input id="p-start" defaultValue="09:15" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-end">End</FieldLabel>
            <Input id="p-end" defaultValue="10:45" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <PopoverClose render={<Button variant="ghost" size="sm">Cancel</Button>} />
          <Button size="sm">Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Simple() {
  return (
    <Popover open modal={false}>
      <PopoverTrigger render={<Button variant="ghost" size="sm">Details</Button>} />
      <PopoverContent className="w-64">
        <PopoverHeader>
          <PopoverTitle>Acme - Website rebuild</PopoverTitle>
          <PopoverDescription>
            32:15 tracked this month against a 20 hour retainer.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}
