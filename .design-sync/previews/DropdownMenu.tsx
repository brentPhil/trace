import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Button,
} from 'chroneli';
import { Pencil, Copy, Trash2, MoreHorizontal } from 'lucide-react';

/* DropdownMenuLabel MUST have a DropdownMenuGroup (or DropdownMenuRadioGroup)
 * ancestor. Base UI throws "MenuGroupContext is missing" and the whole card
 * renders blank if a label is a direct child of the content. */

export function Open() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Entry actions">
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Entry</DropdownMenuLabel>
          <DropdownMenuItem>
            <Pencil />
            Edit
            <DropdownMenuShortcut>E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy />
            Duplicate
            <DropdownMenuShortcut>D</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">
            <Trash2 />
            Delete
            <DropdownMenuShortcut>Del</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WithSelection() {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger render={<Button variant="outline">View</Button>} />
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>Project</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked>Duration</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Billable</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="day">
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioItem value="day">Day</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="project">Project</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="client">Client</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
