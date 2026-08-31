import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from 'chroneli';

export function TitlingASheet() {
  return (
    <Sheet open modal={false}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Entry details</SheetTitle>
          <SheetDescription>
            Invoice export bug - Thursday 27 August
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
