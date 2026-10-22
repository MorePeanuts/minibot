"use client";

import { Bot, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PublicSettings } from "@/server/services/settings";
import type { ConversationSummary } from "@/server/services/conversations";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ConversationList } from "./conversation-list";
import { UserMenu } from "./user-menu";

interface AppSidebarProps {
  user: { name: string; email: string };
  conversations: ConversationSummary[];
  settings: PublicSettings;
}

export function AppSidebar({ user, conversations, settings }: AppSidebarProps) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Bot className="size-4" />
                </div>
                <span className="font-semibold">MiniBot</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                setOpenMobile(false);
                router.push("/");
                // A fresh id is generated server-side for every visit of "/".
                router.refresh();
              }}
            >
              <SquarePen />
              New chat
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <ConversationList conversations={conversations} />
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} settings={settings} />
      </SidebarFooter>
    </Sidebar>
  );
}
