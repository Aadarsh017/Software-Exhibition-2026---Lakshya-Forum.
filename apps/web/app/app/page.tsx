import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/chat-app";

export const metadata: Metadata = { title: "Ask a question" };

export default function AppHomePage() {
  return <ChatApp />;
}
