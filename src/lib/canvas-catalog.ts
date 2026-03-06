/**
 * Canvas Catalog — json-render component registry using shadcn/ui components
 *
 * Uses the pre-built shadcn components from @json-render/shadcn.
 * The schema defines what spec format the AI outputs, the catalog defines
 * which components are available, and the registry maps them to React.
 */
import { schema } from '@json-render/react';
import { shadcnComponentDefinitions, shadcnComponents } from '@json-render/shadcn';
import { defineRegistry, type ComponentRegistry } from '@json-render/react';
import type { Spec } from '@json-render/core';

// ── Catalog ────────────────────────────────────────────────────────────
// Use ALL shadcn components — the AI can generate any of them

export const canvasCatalog = schema.createCatalog({
  components: shadcnComponentDefinitions,
  actions: {},
});

// ── Registry ───────────────────────────────────────────────────────────
// Map all shadcn component definitions to their React implementations.
// We cast because the type inference between the shadcn package and
// defineRegistry is complex — the implementations match at runtime.

const registryResult = defineRegistry(canvasCatalog, {
  components: shadcnComponents as any,
  actions: {} as any,
});

export const canvasRegistry: ComponentRegistry = registryResult.registry;

// ── Spec Helpers ───────────────────────────────────────────────────────

export interface SpecElement {
  key: string;
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

/**
 * Convert an array of flat JSONL elements into a json-render Spec.
 * Elements use key/parent-child references. The first element is the root.
 */
export function elementsToSpec(elements: SpecElement[]): Spec | null {
  if (elements.length === 0) return null;

  const rootKey = elements[0].key;
  const elementMap: Record<string, any> = {};

  for (const el of elements) {
    elementMap[el.key] = {
      type: el.type,
      props: el.props || {},
      ...(el.children?.length ? { children: el.children } : {}),
    };
  }

  return {
    root: rootKey,
    elements: elementMap,
  } as unknown as Spec;
}
