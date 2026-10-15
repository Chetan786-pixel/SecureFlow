import { DashboardClientLayout } from "./dashboard-client-layout";
import { getVoiceAlerts } from "@/lib/actions/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const voiceAlertsEnabled = await getVoiceAlerts();

  return (
    <DashboardClientLayout voiceAlertsEnabled={voiceAlertsEnabled}>
      {children}
    </DashboardClientLayout>
  );
}
