import { Bot, Code, Globe, Sparkles } from "lucide-react";

const SUGGESTIONS = [
  { icon: Globe, text: "What are the most important AI news this week?" },
  { icon: Code, text: "Write a Python script that prints the first 20 primes, then run it" },
  { icon: Sparkles, text: "Explain TypeScript's structural typing to a Go developer" },
];

export function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Bot className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">How can I help you today?</h1>
        <p className="text-sm text-muted-foreground">
          I can search the web and run code in a private sandbox.
        </p>
      </div>
      <div className="grid w-full max-w-3xl gap-2 sm:grid-cols-3">
        {SUGGESTIONS.map(({ icon: Icon, text }) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="flex flex-col gap-2 rounded-xl border p-3 text-left text-sm transition hover:bg-accent"
          >
            <Icon className="size-4 text-muted-foreground" />
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
