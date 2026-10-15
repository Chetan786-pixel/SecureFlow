import SettingsClient from "./settings-client";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getSlackWebhook, getVoiceAlerts } from "@/lib/actions/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const [initialWebhookUrl, initialVoiceAlertsEnabled] = await Promise.all([
    getSlackWebhook(),
    getVoiceAlerts(),
  ]);

  return (
    <SettingsClient
      initialWebhookUrl={initialWebhookUrl}
      initialVoiceAlertsEnabled={initialVoiceAlertsEnabled}
    />
  );
}
