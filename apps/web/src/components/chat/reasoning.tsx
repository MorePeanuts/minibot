"use client";

import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  // Open while the model is thinking; collapsed afterwards unless the user opens it.
  const [userOpen, setUserOpen] = useState<boolean>();
  const open = userOpen ?? streaming;

  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
        <Brain className={cn("size-4", streaming && "animate-pulse")} />
        {streaming ? "Thinking…" : "Thought process"}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 border-l-2 pl-4 text-sm whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
