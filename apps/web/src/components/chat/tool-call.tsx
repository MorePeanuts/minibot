"use client";

import type { WebSearchDetails } from "@minibot/agent";
import type { DynamicToolUIPart } from "ai";
import {
  ChevronRight,
  FileEdit,
  FilePen,
  FileText,
  FolderTree,
  Globe,
  Loader2,
  Search,
  SquareTerminal,
  TextSearch,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ToolOutput } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const TOOL_META: Record<
  string,
  { icon: typeof Globe; label: string; summary: (input: any) => string }
> = {
  web_search: { icon: Search, label: "Searched the web", summary: (i) => i?.query ?? "" },
  web_fetch: { icon: Globe, label: "Read page", summary: (i) => i?.url ?? "" },
  bash: { icon: SquareTerminal, label: "Ran command", summary: (i) => i?.command ?? "" },
  read: { icon: FileText, label: "Read file", summary: (i) => i?.path ?? "" },
  write: { icon: FilePen, label: "Wrote file", summary: (i) => i?.path ?? "" },
  edit: { icon: FileEdit, label: "Edited file", summary: (i) => i?.path ?? "" },
  ls: { icon: FolderTree, label: "Listed directory", summary: (i) => i?.path ?? "." },
  find: { icon: Search, label: "Found files", summary: (i) => i?.pattern ?? "" },
  grep: { icon: TextSearch, label: "Searched files", summary: (i) => i?.pattern ?? "" },
};

function SearchSources({ details }: { details: WebSearchDetails }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {details.sources.map((s) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-accent"
          >
            {s.siteIcon ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party favicons
              <img src={s.siteIcon} alt="" className="mt-0.5 size-4 rounded-sm" />
            ) : (
              <Globe className="mt-0.5 size-4 text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className="line-clamp-1 font-medium">{s.title}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {s.siteName ?? new URL(s.url).hostname}
                {s.date && ` · ${s.date.slice(0, 10)}`}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ToolCall({ part }: { part: DynamicToolUIPart }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[part.toolName] ?? {
    icon: SquareTerminal,
    label: part.toolName,
    summary: () => "",
  };
  const Icon = meta.icon;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const output = part.state === "output-available" ? (part.output as ToolOutput) : undefined;
  const isSearch = part.toolName === "web_search" && output?.details;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-accent/50">
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : failed ? (
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 font-medium">{meta.label}</span>
        <code className="truncate font-mono text-xs text-muted-foreground">
          {part.input ? meta.summary(part.input) : ""}
        </code>
        <ChevronRight
          className={cn("ml-auto size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        {isSearch ? (
          <SearchSources details={output.details as WebSearchDetails} />
        ) : (
          <div className="flex flex-col gap-2 text-xs">
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono">
              {JSON.stringify(part.input, null, 2)}
            </pre>
            {(output || failed) && (
              <pre
                className={cn(
                  "max-h-80 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap",
                  failed && "text-destructive",
                )}
              >
                {failed ? part.errorText : output?.text}
              </pre>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
