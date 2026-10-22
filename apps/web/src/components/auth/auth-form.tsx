"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1, "Name is required").max(50),
});

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const isRegister = mode === "register";

  /** Returns an error message, or undefined on success. */
  const authenticate = async (values: Record<string, unknown>): Promise<string | undefined> => {
    const parsed = isRegister ? registerSchema.safeParse(values) : loginSchema.safeParse(values);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
    const { error } = isRegister
      ? await signUp.email(registerSchema.parse(values))
      : await signIn.email(parsed.data);
    return error ? (error.message ?? "Authentication failed") : undefined;
  };

  const onSubmit = (formData: FormData) =>
    startTransition(async () => {
      setError(undefined);
      const failure = await authenticate(Object.fromEntries(formData));
      if (failure) {
        setError(failure);
        return;
      }
      router.push("/");
      router.refresh();
    });

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">
          {isRegister ? "Create an account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {isRegister
            ? "Start chatting with MiniBot in seconds."
            : "Sign in to continue to MiniBot."}
        </CardDescription>
      </CardHeader>
      <form action={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          {isRegister && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Please wait…" : isRegister ? "Sign up" : "Sign in"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {isRegister ? "Already have an account? " : "Don't have an account? "}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="text-foreground underline underline-offset-4"
            >
              {isRegister ? "Sign in" : "Sign up"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
