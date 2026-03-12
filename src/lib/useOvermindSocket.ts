/**
 * useOvermindSocket — Real-Time Overmind Event Stream
 *
 * Connects to the ws://localhost:3100/ws/overmind WebSocket.
 * Receives an initial snapshot on connect, then live events as
 * the orchestrator ticks, workers report, and jobs change state.
 *
 * Provides a single source of truth for all Overmind UI components,
 * eliminating the need for polling.
 *
 * Event types from server:
 * - snapshot:         Full state dump on connect
 * - fleet_update:     Worker status change
 * - job_update:       Job status change
 * - chat_message:     Inbound/outbound chat event
 * - orchestrator_health: Periodic health report
 * - checkpoint:       Worker checkpoint recorded
 * - command:          Worker command sent/ack/complete
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { FleetStatus, OrchestratorStatus } from './overmind';

// ─── Types ────────────────────────────────────────────────

export interface OvermindSnapshot {
  jobs: Array<{ id: string; title: string; status: string }>;
  agents: Array<{ id: string; name: string; status: string; current_load: number }>;
  fleet: {
    workers: Array<{
      id: string;
      name: string;
      status: string;
      current_load: number;
      context_usage: number;
    }>;
    status: FleetStatus | null;
  };
  orchestrator: OrchestratorStatus | null;
}

export interface OvermindEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface OvermindSocketState {
  connected: boolean;
  snapshot: OvermindSnapshot | null;
  lastEvent: OvermindEvent | null;
  eventCount: number;
}

// ─── Hook ─────────────────────────────────────────────────

/**
 * Connect to the Overmind WebSocket for real-time updates.
 *
 * @param enabled  Set to false to disable the connection (e.g., when the tab is not active)
 * @returns Live state + reconnect function
 */
export function useOvermindSocket(enabled = true): OvermindSocketState & {
  reconnect: () => void;
} {
  const [state, setState] = useState<OvermindSocketState>({
    connected: false,
    snapshot: null,
    lastEvent: null,
    eventCount: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventCountRef = useRef(0);

  const connect = useCallback(() => {
    // Determine WebSocket URL from current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In dev mode, the API is proxied through Vite, but WebSocket needs direct connection
    // to the API server at port 3100
    const wsHost = import.meta.env.DEV
      ? 'localhost:3100'
      : window.location.host;
    const wsUrl = `${protocol}//${wsHost}/ws/overmind`;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({ ...prev, connected: true }));
        // Clear any pending reconnect
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          eventCountRef.current++;

          if (msg.type === 'snapshot') {
            setState(prev => ({
              ...prev,
              snapshot: msg.data as OvermindSnapshot,
              lastEvent: msg,
              eventCount: eventCountRef.current,
            }));
          } else {
            setState(prev => ({
              ...prev,
              lastEvent: msg,
              eventCount: eventCountRef.current,
            }));
          }
        } catch {
          // Skip malformed messages
        }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }));
        wsRef.current = null;

        // Auto-reconnect after 5 seconds
        if (enabled) {
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, 5000);
        }
      };

      ws.onerror = () => {
        // Error will trigger onclose, which handles reconnection
      };
    } catch {
      // Connection failed — retry
      setState(prev => ({ ...prev, connected: false }));
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }
  }, [enabled]);

  // Connect/disconnect based on enabled prop
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [enabled, connect]);

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connect();
  }, [connect]);

  return { ...state, reconnect };
}
