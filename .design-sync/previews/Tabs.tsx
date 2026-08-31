import { Tabs, TabsList, TabsTrigger, TabsContent } from 'chroneli';

export function Default() {
  return (
    <Tabs defaultValue="day" className="w-96">
      <TabsList>
        <TabsTrigger value="day">Day</TabsTrigger>
        <TabsTrigger value="week">Week</TabsTrigger>
        <TabsTrigger value="month">Month</TabsTrigger>
      </TabsList>
      <TabsContent value="day" className="pt-4 text-sm text-muted-foreground">
        Three entries totalling 6:40.
      </TabsContent>
    </Tabs>
  );
}

export function Line() {
  return (
    <Tabs defaultValue="entries" className="w-96">
      <TabsList variant="line">
        <TabsTrigger value="entries">Entries</TabsTrigger>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
      </TabsList>
      <TabsContent value="entries" className="pt-4 text-sm text-muted-foreground">
        Every entry logged in the selected range.
      </TabsContent>
    </Tabs>
  );
}

export function Vertical() {
  return (
    <Tabs defaultValue="general" orientation="vertical" className="flex w-96 gap-4">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="theme">Theme</TabsTrigger>
      </TabsList>
      <TabsContent value="general" className="text-sm text-muted-foreground">
        Account name, timezone and the week's first day.
      </TabsContent>
    </Tabs>
  );
}
