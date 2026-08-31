import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  Avatar,
  AvatarFallback,
} from 'chroneli';

/* `collapsible="none"` keeps the rail inside the card: the default is
 * `fixed inset-y-0 h-svh` and hidden below the md breakpoint. */

export function AboveTheContent() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-56 w-64 border-r">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <Avatar size="sm">
                  <AvatarFallback>BO</AvatarFallback>
                </Avatar>
                <div className="flex flex-col text-left leading-tight">
                  <span className="font-medium">Brent Ortega</span>
                  <span className="text-xs text-muted-foreground">Acme Corp</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent />
      </Sidebar>
    </SidebarProvider>
  );
}
