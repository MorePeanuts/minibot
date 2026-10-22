"use client";

import { isToday, isYesterday, subDays } from "date-fns";
import { Archive, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveConversationAction,
  deleteConversationAction,
  renameConversationAction,
} from "@/actions/conversations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ConversationSummary } from "@/server/services/conversations";

function groupByDate(conversations: ConversationSummary[]) {
  const weekAgo = subDays(new Date(), 7);
  const monthAgo = subDays(new Date(), 30);
  const groups: Record<string, ConversationSummary[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    "Previous 30 days": [],
    Older: [],
  };
  for (const c of conversations) {
    const date = new Date(c.updatedAt);
    const key = isToday(date)
      ? "Today"
      : isYesterday(date)
        ? "Yesterday"
        : date > weekAgo
          ? "Previous 7 days"
          : date > monthAgo
            ? "Previous 30 days"
            : "Older";
    groups[key]!.push(c);
  }
  return Object.entries(groups).filter(([, items]) => items.length > 0);
}

function ConversationItem({ conversation }: { conversation: ConversationSummary }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const href = `/c/${conversation.id}` as const;
  const active = pathname === href;

  const run = (action: () => Promise<void>, success: string, leave = false) =>
    startTransition(async () => {
      try {
        await action();
        toast.success(success);
        if (leave && active) router.push("/");
      } catch {
        toast.error("Something went wrong");
      }
    });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} disabled={pending}>
        <Link href={href} onClick={() => setOpenMobile(false)} title={conversation.title}>
          <span className="truncate">{conversation.title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Conversation actions">
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run(() => archiveConversationAction(conversation.id, true), "Chat archived", true)
            }
          >
            <Archive /> Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <form
            id={`rename-${conversation.id}`}
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              run(() => renameConversationAction(conversation.id, title), "Chat renamed");
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" form={`rename-${conversation.id}`} disabled={!title.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{conversation.title}” and its sandbox files.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                run(() => deleteConversationAction(conversation.id), "Chat deleted", true)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  if (conversations.length === 0) {
    return (
      <p className="px-4 py-2 text-sm text-muted-foreground">
        Your conversations will appear here.
      </p>
    );
  }
  return groupByDate(conversations).map(([label, items]) => (
    <SidebarGroup key={label}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((c) => (
          <ConversationItem key={c.id} conversation={c} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  ));
}
