import { KnowledgeBase } from "../../components/KnowledgeBase";
import { Section } from "./Section";

export function KnowledgeSection() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="Knowledge Base" icon="\u{1F4DA}" description="RAG-powered document search via AnythingLLM">
        <KnowledgeBase />
      </Section>
    </div>
  );
}
