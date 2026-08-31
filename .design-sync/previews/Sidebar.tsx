import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarGroupAction,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarSeparator,
  SidebarInput,
  Avatar,
  AvatarFallback,
} from 'chroneli';
import {
  Timer,
  ListTree,
  BarChart3,
  FileText,
  Settings,
  Plus,
  MoreHorizontal,
  Search,
} from 'lucide-react';

/* `collapsible="none"` is what makes the rail renderable in a card: the
 * default (`offcanvas`) is `fixed inset-y-0 h-svh` and hidden below `md`, so
 * it escapes the card entirely and measures zero. Everything else here is the
 * shell exactly as the app composes it. */

export function Navigation() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-[480px] w-64 border-r">
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

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Track</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <Timer />
                    Timer
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <ListTree />
                    Log
                  </SidebarMenuButton>
                  <SidebarMenuBadge>12</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <BarChart3 />
                    Reports
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Clients</SidebarGroupLabel>
            <SidebarGroupAction aria-label="Add client">
              <Plus />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <FileText />
                    Acme Corp
                  </SidebarMenuButton>
                  <SidebarMenuAction aria-label="Client actions">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>
                        Website rebuild
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>Mobile app</SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <Settings />
                Settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}

export function WithSearch() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-64 w-64 border-r">
        <SidebarHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput placeholder="Find a project" className="pl-8" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>Website rebuild</SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Mobile app</SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Internal - Admin</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

export function Loading() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-64 w-64 border-r">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Clients</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {[0, 1, 2, 3].map((i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
