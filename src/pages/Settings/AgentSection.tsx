import { AgentNaming } from "../../components/AgentNaming";
import { ModelConfiguration } from "../../components/ModelConfiguration";
import { CompoundCapture } from "../../components/CompoundCapture";
import { Section } from "./Section";

export function AgentSection() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="Agent Personalization" icon="\u{1F916}" description="Name and avatar for your agent">
        <AgentNaming />
      </Section>

      <Section title="Model Configuration" icon="\u{1F9E0}" description="Choose AI models and budget tier">
        <ModelConfiguration />
      </Section>

      <Section title="Compound Learning" icon="\u{1F4DA}" description="Knowledge capture and memory">
        <CompoundCapture />
      </Section>
    </div>
  );
}
