import { Separator } from 'chroneli';

export function Horizontal() {
  return (
    <div className="w-72 text-sm">
      <div className="py-2">Sprint planning</div>
      <Separator />
      <div className="py-2">Invoice export bug</div>
      <Separator />
      <div className="py-2">Design review</div>
    </div>
  );
}

export function Vertical() {
  return (
    <div className="flex h-6 items-center gap-3 text-sm text-muted-foreground">
      <span>Today</span>
      <Separator orientation="vertical" />
      <span>3 entries</span>
      <Separator orientation="vertical" />
      <span className="font-mono tabular-nums">6:40</span>
    </div>
  );
}
