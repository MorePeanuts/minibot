import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { listConversations } from "@/server/services/conversations";
import { getPublicSettings } from "@/server/services/settings";
import { requireUser } from "@/server/session";

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [conversations, settings, cookieStore] = await Promise.all([
    listConversations(user.id),
    getPublicSettings(user.id),
    cookies(),
  ]);

  return (
    <SidebarProvider defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
      <AppSidebar
        user={{ name: user.name, email: user.email }}
        conversations={conversations}
        settings={settings}
      />
      <SidebarInset className="h-svh">{children}</SidebarInset>
    </SidebarProvider>
  );
}
