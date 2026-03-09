import toast from "react-hot-toast";
import { WhatsAppConnect } from "../../components/WhatsAppConnect";
import { SlackWizard } from "../../components/SlackWizard";
import { Section } from "./Section";

export function CommunicationSection() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="WhatsApp" icon="\u{1F4F1}" description="Connect via QR code scan">
        <WhatsAppConnect />
      </Section>

      <Section title="Slack Integration" icon="\u{1F4AC}" description="Connect your Slack workspace">
        <SlackWizard
          onComplete={() => toast.success("Slack connected!")}
          embedded={false}
        />
      </Section>
    </div>
  );
}
