import { createFileRoute } from "@tanstack/react-router";
import { ResetScreen } from "@/components/auth-screen";

export const Route = createFileRoute("/reset-password")({ component: ResetScreen });
