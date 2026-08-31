import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from 'chroneli';
import { Timer, ListTree } from 'lucide-react';

/* SidebarProvider owns the open/collapsed state and the keyboard shortcut, and
 * every other Sidebar part reads it from context. It renders no chrome of its
 * own, so it is shown here doing its actual job: wrapping a rail. */

export function WrappingARail() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-56 w-64 border-r">
        <SidebarContent>
          <SidebarGroup>
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
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
