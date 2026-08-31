import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuAction,
} from 'chroneli';
import { MoreHorizontal } from 'lucide-react';

/* `collapsible="none"` keeps the rail inside the card: the default is
 * `fixed inset-y-0 h-svh` and hidden below the md breakpoint. */

export function RowsWithTrailingParts() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-56 w-64 border-r">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>Timer</SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Log</SidebarMenuButton>
                  <SidebarMenuBadge>12</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>Reports</SidebarMenuButton>
                  <SidebarMenuAction aria-label="Report actions">
                    <MoreHorizontal />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
