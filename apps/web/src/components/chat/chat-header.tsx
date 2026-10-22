import { SUPPORTED_MODELS } from "@minibot/agent/catalog";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface ChatHeaderProps {
  title: string;
  model: string;
  archived?: boolean;
}

export function ChatHeader({ title, model, archived }: ChatHeaderProps) {
  const modelLabel = SUPPORTED_MODELS.find((m) => m.id === model)?.label ?? model;
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <SidebarTrigger />
      <h1 className="truncate text-sm font-medium">{title}</h1>
      {archived && <Badge variant="secondary">Archived</Badge>}
      <Badge variant="outline" className="ml-auto font-normal">
        {modelLabel}
      </Badge>
    </header>
  );
}
