import { Chat } from "@/components/Chat";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <Chat initialQuestion={q?.slice(0, 500)} />;
}
