import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from 'chroneli';
import { Settings } from 'lucide-react';

/* `collapsible="none"` keeps the rail inside the card: the default is
 * `fixed inset-y-0 h-svh` and hidden below the md breakpoint. */

export function BelowTheContent() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-56 w-64 border-r">
        <SidebarContent />
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
