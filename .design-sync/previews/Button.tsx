import { Button } from 'chroneli';
import { Play, Square, Plus, Trash2, ChevronDown } from 'lucide-react';

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Start timer</Button>
      <Button variant="secondary">Save draft</Button>
      <Button variant="outline">Export CSV</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete entry</Button>
      <Button variant="link">View invoice</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Play data-icon="inline-start" />
        Start
      </Button>
      <Button variant="outline">
        <Square data-icon="inline-start" />
        Stop
      </Button>
      <Button variant="secondary">
        Project
        <ChevronDown data-icon="inline-end" />
      </Button>
    </div>
  );
}

export function IconOnly() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-xs" variant="ghost" aria-label="Add">
        <Plus />
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Start">
        <Play />
      </Button>
      <Button size="icon" aria-label="Stop">
        <Square />
      </Button>
      <Button size="icon-lg" variant="destructive" aria-label="Delete">
        <Trash2 />
      </Button>
    </div>
  );
}

/* The four sizes shadcn does not ship. Each is geometry the log's layout
 * measures elsewhere, so they are worth showing on their own. */
export function ChroneliSizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="icon-row" variant="ghost" aria-label="Row action">
        <Trash2 />
      </Button>
      <Button size="chip" variant="outline">
        Billable
      </Button>
      <Button size="row-trigger" variant="ghost">
        09:15 - 10:45
      </Button>
      <Button size="badge" variant="secondary">
        12
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Start timer</Button>
      <Button variant="outline" disabled>
        Export CSV
      </Button>
      <Button variant="destructive" disabled>
        Delete entry
      </Button>
    </div>
  );
}
