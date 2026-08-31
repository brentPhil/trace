import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
  Separator,
} from 'chroneli';

export function Basic() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>This week</CardTitle>
        <CardDescription>Monday 25 - Sunday 31 August</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl tabular-nums">32:15</span>
          <span className="text-muted-foreground">of 40:00 tracked</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function WithAction() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Acme Corp</CardTitle>
        <CardDescription>Retainer - 20 hours per month</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Four projects billing to this client. The retainer resets on the first
        of each month; anything above it invoices at the standard rate.
      </CardContent>
      <CardFooter>
        <Button size="sm">Create invoice</Button>
      </CardFooter>
    </Card>
  );
}

export function Small() {
  return (
    <Card size="sm" className="max-w-xs">
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>3 entries</CardDescription>
      </CardHeader>
      <CardContent className="font-mono text-xl tabular-nums">6:40</CardContent>
    </Card>
  );
}

export function WithSeparatedRows() {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Recent entries</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span>Sprint planning</span>
          <span className="font-mono tabular-nums text-muted-foreground">1:30</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span>Invoice export bug</span>
          <span className="font-mono tabular-nums text-muted-foreground">2:45</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <span>Design review</span>
          <span className="font-mono tabular-nums text-muted-foreground">0:45</span>
        </div>
      </CardContent>
    </Card>
  );
}
