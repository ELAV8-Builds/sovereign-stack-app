/**
 * Types, constants, and helpers for the DataConnectionWizard
 */
import type {
  StoredConnection,
  CustomWebhook,
  DataSource,
  NangoDataSource,
  WebhookDataSource,
  DataSourceConfig,
} from "@/lib/integrations";

// Re-export types from integrations that are used across wizard files
export type {
  StoredConnection,
  CustomWebhook,
  DataSource,
  NangoDataSource,
  WebhookDataSource,
  DataSourceConfig,
};

// ── Types ──────────────────────────────────────────────────────────────

export type WizardStep = "describe" | "connect" | "building" | "done";

export interface DiscoveryResult {
  success: boolean;
  statusCode?: number;
  contentType?: string;
  schemaHints?: any;
  needsAuth?: boolean;
  error?: string;
}

export interface DataConnectionWizardProps {
  onComplete: (result: {
    prompt: string;
    dataSources: DataSourceConfig;
    pageName: string;
  }) => void;
  onCancel: () => void;
}

// ── Integration Categories ─────────────────────────────────────────────

export const INTEGRATION_CATEGORIES: { id: string; label: string; icon: string; keywords: string[] }[] = [
  { id: "crm", label: "CRM", icon: "\u{1F465}", keywords: ["hubspot", "salesforce", "pipedrive", "zoho", "attio", "close", "copper"] },
  { id: "accounting", label: "Accounting", icon: "\u{1F4D2}", keywords: ["quickbooks", "xero", "freshbooks", "wave", "sage"] },
  { id: "dev", label: "Developer", icon: "\u{1F4BB}", keywords: ["github", "gitlab", "bitbucket", "jira", "linear", "notion"] },
  { id: "comms", label: "Communication", icon: "\u{1F4AC}", keywords: ["slack", "discord", "teams", "twilio", "intercom"] },
  { id: "productivity", label: "Productivity", icon: "\u26A1", keywords: ["google", "microsoft", "airtable", "asana", "monday", "clickup"] },
  { id: "ecommerce", label: "E-commerce", icon: "\u{1F6D2}", keywords: ["shopify", "stripe", "woocommerce", "square", "paypal"] },
  { id: "analytics", label: "Analytics", icon: "\u{1F4C8}", keywords: ["amplitude", "mixpanel", "segment", "google-analytics", "plausible"] },
  { id: "marketing", label: "Marketing", icon: "\u{1F4E3}", keywords: ["mailchimp", "sendgrid", "klaviyo", "brevo", "activecampaign"] },
  { id: "storage", label: "Storage", icon: "\u{1F4C1}", keywords: ["google-drive", "dropbox", "onedrive", "box", "s3"] },
  { id: "other", label: "Other", icon: "\u{1F517}", keywords: [] },
];

export function categorizeIntegration(uniqueKey: string): string {
  const lower = uniqueKey.toLowerCase();
  for (const cat of INTEGRATION_CATEGORIES) {
    if (cat.keywords.some(kw => lower.includes(kw))) return cat.id;
  }
  return "other";
}
