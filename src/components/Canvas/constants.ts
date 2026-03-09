/**
 * Canvas — Constants and static data
 */
import type { SmartSuggestion } from "./types";

export const SMART_SUGGESTIONS: SmartSuggestion[] = [
  // Available when specific vault keys are configured
  { keys: ['slack_bot'], icon: '\u{1F4AC}', title: 'Slack Priority Briefing', prompt: 'Connect to Slack, scan my channels, and build a priority briefing showing urgent messages, action items, and key decisions I need to make', service: 'Slack' },
  { keys: ['brave_search'], icon: '\u{1F50D}', title: 'Competitive Intelligence', prompt: 'Research my top 5 competitors using web search and build a comparison dashboard with pricing, features, and market positioning', service: 'Brave Search' },
  { keys: ['openai', 'anthropic'], icon: '\u{1F3D7}\uFE0F', title: 'Architecture Overview', prompt: 'Analyze the codebase in this workspace and generate an architecture diagram with component dependencies, data flow, and tech stack summary', service: 'AI Analysis' },
  { keys: ['elevenlabs'], icon: '\u{1F399}\uFE0F', title: 'Voice Content Studio', prompt: 'Create a voice content dashboard where I can write scripts, generate audio previews, and manage my voice content library', service: 'ElevenLabs' },
  // Always available (no vault key requirement)
  { keys: [], icon: '\u{1F4CA}', title: 'Connect to Notion & Summarize Marketing', prompt: 'Connect to my Notion workspace, find all marketing-related pages and databases, and build a summary dashboard with campaign status, content calendar, and key metrics', service: 'Custom API' },
  { keys: [], icon: '\u{1F4B0}', title: 'QuickBooks P&L with CPA Advice', prompt: 'Connect to QuickBooks, pull my Profit & Loss statement, and build an interactive financial dashboard with AI-powered CPA-level advice on tax optimization and cash flow', service: 'Custom API' },
  { keys: [], icon: '\u{1F4E7}', title: 'Email Triage & Priority Board', prompt: 'Connect to my email, scan the last 48 hours, and build a triage board showing urgent items, follow-ups needed, and emails I can safely archive', service: 'Custom API' },
  { keys: [], icon: '\u{1F4C8}', title: 'Build a Live API Dashboard', prompt: 'I want to connect to a custom API endpoint and build a real-time monitoring dashboard that auto-refreshes with the latest data', service: 'Any API' },
];
