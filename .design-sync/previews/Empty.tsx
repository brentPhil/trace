import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Button,
} from 'chroneli';
import { Clock, Search, FileText } from 'lucide-react';

export function Default() {
  return (
    <Empty className="w-96">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Clock />
        </EmptyMedia>
        <EmptyTitle>No entries today</EmptyTitle>
        <EmptyDescription>
          Start the timer, or add an entry for time you tracked elsewhere.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">Start timer</Button>
      </EmptyContent>
    </Empty>
  );
}

export function NoResults() {
  return (
    <Empty className="w-96">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>Nothing matches those filters</EmptyTitle>
        <EmptyDescription>
          No entries between 1 and 31 August for the client "Acme Corp".
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline">
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function PlainMedia() {
  return (
    <Empty className="w-96">
      <EmptyHeader>
        <EmptyMedia>
          <FileText className="size-8 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No invoices yet</EmptyTitle>
        <EmptyDescription>
          Invoices you draw from tracked time will collect here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
