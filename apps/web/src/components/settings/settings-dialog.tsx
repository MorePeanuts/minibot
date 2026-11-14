"use client";

import {
  SUPPORTED_MODELS,
  THINKING_LEVELS,
  type ChatProvider,
  type MiniBotThinkingLevel,
  type ModelId,
} from "@minibot/agent/catalog";
import { ArchiveRestore, KeyRound, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  archiveConversationAction,
  deleteConversationAction,
  listArchivedConversationsAction,
} from "@/actions/conversations";
import { updateSettingsAction, type SettingsInput } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConversationSummary } from "@/server/services/conversations";
import type { PublicSettings } from "@/server/services/settings";

const THINKING_LABELS: Record<MiniBotThinkingLevel, string> = {
  off: "Off — fastest",
  low: "Low",
  high: "High",
  max: "Max — most thorough",
};

function GeneralSettings({ settings }: { settings: PublicSettings }) {
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState(settings.chatProvider);
  const [baseUrl, setBaseUrl] = useState(settings.responsesBaseUrl ?? "");
  const [modelId, setModelId] = useState(settings.responsesModel ?? "");
  const [responsesKey, setResponsesKey] = useState("");
  const [reasoning, setReasoning] = useState(settings.responsesReasoning);
  const [pending, startTransition] = useTransition();

  const save = (input: SettingsInput, message: string) =>
    startTransition(async () => {
      const result = await updateSettingsAction(input);
      if (result.ok) {
        toast.success(message);
        if (input.apiKey !== undefined) setApiKey("");
        if (input.responsesApiKey !== undefined) setResponsesKey("");
      } else {
        if (input.chatProvider === "deepseek") setProvider(settings.chatProvider);
        toast.error(result.error);
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="chat-provider">Chat provider</Label>
        <Select
          value={provider}
          onValueChange={(value) => {
            const selected = value as ChatProvider;
            setProvider(selected);
            if (selected === "deepseek" && settings.chatProvider !== selected) {
              save({ chatProvider: selected }, "Chat provider updated");
            }
          }}
          disabled={pending}
        >
          <SelectTrigger id="chat-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deepseek">DeepSeek</SelectItem>
            <SelectItem value="responses">Custom Responses API</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "responses" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(
              {
                chatProvider: "responses",
                responsesBaseUrl: baseUrl,
                responsesModel: modelId,
                responsesReasoning: reasoning,
                ...(responsesKey.trim() && { responsesApiKey: responsesKey }),
              },
              "Responses settings saved",
            );
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="responses-base-url">Base URL</Label>
            <Input
              id="responses-base-url"
              type="url"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="responses-model">Model ID</Label>
            <Input
              id="responses-model"
              placeholder="Model ID from your provider"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="responses-api-key">Responses API key</Label>
            <Input
              id="responses-api-key"
              type="password"
              autoComplete="off"
              placeholder={settings.maskedResponsesApiKey ?? "API key from your provider"}
              value={responsesKey}
              onChange={(e) => setResponsesKey(e.target.value)}
              required={!settings.maskedResponsesApiKey}
            />
            {settings.maskedResponsesApiKey && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <KeyRound className="size-3.5" />
                Current key: <code>{settings.maskedResponsesApiKey}</code>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-destructive"
                  disabled={pending}
                  onClick={() => save({ responsesApiKey: null }, "Responses API key removed")}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
          <Label className="gap-2 font-normal">
            <input
              type="checkbox"
              checked={reasoning}
              onChange={(e) => setReasoning(e.target.checked)}
            />
            Send reasoning settings to this model
          </Label>
          <Button type="submit" className="self-start" disabled={pending}>
            Save Responses settings
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="api-key">DeepSeek API key</Label>
        <p className="text-sm text-muted-foreground">
          Used for DeepSeek chat, web search, OCR, and voice. Get one at{" "}
          <Link
            href="https://platform.deepseek.com/api_keys"
            target="_blank"
            className="underline underline-offset-4"
          >
            platform.deepseek.com
          </Link>
          .
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ apiKey: apiKey.trim() }, "API key saved");
          }}
        >
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            placeholder={settings.maskedApiKey ?? "sk-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <Button type="submit" disabled={pending || apiKey.trim().length < 10}>
            Save
          </Button>
        </form>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRound className="size-3.5" />
          {settings.maskedApiKey ? (
            <>
              Current key: <code>{settings.maskedApiKey}</code>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                onClick={() => save({ apiKey: null }, "API key removed")}
              >
                Remove
              </Button>
            </>
          ) : settings.hasServerKey ? (
            "Using the server's default key."
          ) : (
            "No key configured yet."
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {provider === "deepseek" && (
          <div className="flex flex-col gap-2">
            <Label>Model</Label>
            <Select
              defaultValue={settings.model}
              onValueChange={(model) => save({ model: model as ModelId }, "Model updated")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {(provider === "deepseek" ||
          (settings.chatProvider === "responses" && settings.responsesReasoning && reasoning)) && (
          <div className="flex flex-col gap-2">
            <Label>Thinking</Label>
            <Select
              defaultValue={
                provider === "responses" && settings.thinkingLevel === "max"
                  ? "high"
                  : settings.thinkingLevel
              }
              onValueChange={(level) =>
                save({ thinkingLevel: level as MiniBotThinkingLevel }, "Thinking level updated")
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THINKING_LEVELS.filter((level) => provider === "deepseek" || level !== "max").map(
                  (level) => (
                    <SelectItem key={level} value={level}>
                      {THINKING_LABELS[level]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

function ArchivedChats({ active }: { active: boolean }) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [pending, startTransition] = useTransition();

  const reload = () =>
    startTransition(async () => setItems(await listArchivedConversationsAction()));
  useEffect(() => {
    if (active) reload();
  }, [active]);

  const act = (action: () => Promise<void>, message: string) =>
    startTransition(async () => {
      await action();
      toast.success(message);
      setItems(await listArchivedConversationsAction());
    });

  if (!items) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No archived chats.</p>;

  return (
    <ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
      {items.map((c) => (
        <li key={c.id} className="flex items-center gap-2 px-3 py-2">
          <Link href={`/c/${c.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
            {c.title}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Unarchive"
            disabled={pending}
            onClick={() => act(() => archiveConversationAction(c.id, false), "Chat restored")}
          >
            <ArchiveRestore className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            disabled={pending}
            onClick={() => act(() => deleteConversationAction(c.id), "Chat deleted")}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PublicSettings;
}

export function SettingsDialog({ open, onOpenChange, settings }: SettingsDialogProps) {
  const [tab, setTab] = useState("general");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your model provider and manage chats.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="archived">Archived chats</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="pt-4">
            <GeneralSettings settings={settings} />
          </TabsContent>
          <TabsContent value="archived" className="pt-4">
            <ArchivedChats active={open && tab === "archived"} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
