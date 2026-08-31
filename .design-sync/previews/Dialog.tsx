import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Button,
  Field,
  FieldLabel,
  Input,
} from 'chroneli';

/* The dialog is shown OPEN and non-modal: the card has to render the popup
 * itself, and a modal dialog would trap focus and mark the rest of the page
 * inert inside the preview frame. */
export function Open() {
  return (
    <Dialog open modal={false}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>
            "Invoice export bug" logged 2:45 on Thursday. Deleting it cannot be
            undone, and any invoice already drawn from it keeps the old total.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button variant="destructive">Delete entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WithForm() {
  return (
    <Dialog open modal={false}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New manual entry</DialogTitle>
          <DialogDescription>
            Log time you tracked away from the timer.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="entry-title">Description</FieldLabel>
          <Input id="entry-title" defaultValue="Sprint planning" />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button>Add entry</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
