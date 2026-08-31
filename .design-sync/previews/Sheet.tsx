import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  Button,
  Field,
  FieldLabel,
  Input,
  Separator,
} from 'chroneli';

export function Right() {
  return (
    <Sheet open modal={false}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Entry details</SheetTitle>
          <SheetDescription>
            Invoice export bug - Thursday 27 August
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <Field>
            <FieldLabel htmlFor="s-desc">Description</FieldLabel>
            <Input id="s-desc" defaultValue="Invoice export bug" />
          </Field>
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-mono tabular-nums">2:45</span>
          </div>
        </div>
        <SheetFooter>
          <Button>Save changes</Button>
          <SheetClose render={<Button variant="outline">Cancel</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function Left() {
  return (
    <Sheet open modal={false}>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the log to a client or project.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <Field>
            <FieldLabel htmlFor="s-client">Client</FieldLabel>
            <Input id="s-client" defaultValue="Acme Corp" />
          </Field>
        </div>
        <SheetFooter>
          <Button>Apply</Button>
          <SheetClose render={<Button variant="ghost">Clear</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
