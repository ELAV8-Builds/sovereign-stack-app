import { useState, useEffect } from "react";
import { safeInvoke } from "@/lib/tauri";

type ConnectionState = "idle" | "generating" | "waiting" | "scanning" | "connected" | "error";

interface WhatsAppConnectProps {
  onConnected?: () => void;
  compact?: boolean;
}

export function WhatsAppConnect({ onConnected, compact = false }: WhatsAppConnectProps) {
  const [state, setState] = useState<ConnectionState>("idle");
  const [qrData, setQrData] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [deviceName, setDeviceName] = useState<string>("");
  const [countdown, setCountdown] = useState(60);

  // Generate QR code
  const startConnection = async () => {
    setState("generating");
    setError("");

    try {
      const qr = await safeInvoke<string>("generate_whatsapp_qr");
      setQrData(qr);
      setState("waiting");
      setCountdown(60);
    } catch {
      // Mock QR for development
      setQrData("MOCK_QR_DATA_FOR_DEVELOPMENT");
      setState("waiting");
      setCountdown(60);
    }
  };

  // Poll for connection status
  useEffect(() => {
    if (state !== "waiting" && state !== "scanning") return;

    const interval = setInterval(async () => {
      try {
        const status = await safeInvoke<{ connected: boolean; device?: string }>(
          "check_whatsapp_status"
        );
        if (status.connected) {
          setState("connected");
          setDeviceName(status.device || "Unknown Device");
          onConnected?.();
          clearInterval(interval);
        }
      } catch {
        // Mock: simulate connection after some time in dev
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [state, onConnected]);

  // QR expiry countdown
  useEffect(() => {
    if (state !== "waiting") return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setState("idle");
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [state]);

  if (compact) {
    return (
      <div className="space-y-3">
        {state === "connected" ? (
          <div className="flex items-center gap-2 text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium">WhatsApp Connected</span>
            {deviceName && (
              <span className="text-xs text-slate-500">({deviceName})</span>
            )}
          </div>
        ) : state === "waiting" ? (
          <div className="space-y-3">
            <QRDisplay qrData={qrData} size="small" />
            <p className="text-xs text-slate-500 text-center">
              Scan with WhatsApp • {countdown}s
            </p>
          </div>
        ) : (
          <button
            onClick={startConnection}
            disabled={state === "generating"}
            className="w-full px-4 py-3 bg-green-600/20 hover:bg-green-600/30 border border-green-800 rounded-xl text-green-400 font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2"
          >
            <span className="text-lg">📱</span>
            {state === "generating" ? "Generating QR..." : "Connect WhatsApp"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {state === "connected" && (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
          <div>
            <span className="text-green-400 font-semibold">Connected!</span>
            {deviceName && (
              <span className="text-slate-400 text-sm ml-2">
                {deviceName}
              </span>
            )}
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4">
          <span className="text-red-400 text-sm">{error}</span>
          <button
            onClick={startConnection}
            className="ml-3 text-red-400 underline text-sm hover:text-red-300"
          >
            Try again
          </button>
        </div>
      )}

      {/* QR Area */}
      {(state === "idle" || state === "generating") && (
        <div className="text-center space-y-4">
          <button
            onClick={startConnection}
            disabled={state === "generating"}
            className="px-8 py-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 rounded-xl text-white font-semibold text-lg transition-all duration-200 shadow-lg shadow-green-600/20 active:scale-95 disabled:active:scale-100 flex items-center justify-center gap-3 mx-auto"
          >
            <span className="text-2xl">📱</span>
            {state === "generating" ? (
              <>
                <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                Generating QR Code...
              </>
            ) : (
              "Scan to Connect WhatsApp"
            )}
          </button>
        </div>
      )}

      {(state === "waiting" || state === "scanning") && (
        <div className="text-center space-y-4">
          <QRDisplay qrData={qrData} size="large" />

          {/* Instructions */}
          <div className="space-y-2 text-sm text-slate-400 max-w-xs mx-auto">
            <div className="flex items-start gap-2">
              <span className="text-slate-500 font-mono text-xs mt-0.5">1.</span>
              <span>Open WhatsApp on your phone</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-500 font-mono text-xs mt-0.5">2.</span>
              <span>
                Tap{" "}
                <span className="text-slate-300 font-medium">⋯ → Linked Devices</span>
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-500 font-mono text-xs mt-0.5">3.</span>
              <span>Point your phone at this QR code</span>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center justify-center gap-2 text-sm">
            {state === "scanning" ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full" />
                <span className="text-green-400">Connecting...</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400">
                  Waiting for scan... ({countdown}s)
                </span>
              </>
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={startConnection}
            className="text-xs text-slate-500 hover:text-slate-400 underline transition-colors"
          >
            Generate new QR code
          </button>
        </div>
      )}
    </div>
  );
}

// QR code display component (placeholder — real one would use qrcode library)
function QRDisplay({ qrData, size }: { qrData: string; size: "small" | "large" }) {
  const px = size === "large" ? "w-56 h-56" : "w-36 h-36";

  // Generate a visual QR-like pattern from the data
  const pattern = Array.from({ length: size === "large" ? 21 : 15 }, (_, row) =>
    Array.from(
      { length: size === "large" ? 21 : 15 },
      (_, col) => {
        // Corner squares (finder patterns)
        const isCorner =
          (row < 3 && col < 3) ||
          (row < 3 && col >= (size === "large" ? 18 : 12)) ||
          (row >= (size === "large" ? 18 : 12) && col < 3);
        if (isCorner) return true;

        // Semi-random data pattern based on position
        return ((row * 7 + col * 13 + qrData.length) % 3) !== 0;
      }
    )
  );

  const cellSize = size === "large" ? 10 : 8;
  const gridSize = pattern.length;
  const svgSize = gridSize * cellSize + 8;

  return (
    <div className={`${px} mx-auto bg-white rounded-xl p-2 shadow-lg relative`}>
      <svg viewBox={`0 0 ${svgSize} ${svgSize}`} className="w-full h-full">
        {/* White background */}
        <rect width={svgSize} height={svgSize} fill="white" rx="4" />
        {/* Cells */}
        {pattern.map((row, ri) =>
          row.map((cell, ci) =>
            cell ? (
              <rect
                key={`${ri}-${ci}`}
                x={ci * cellSize + 4}
                y={ri * cellSize + 4}
                width={cellSize - 1}
                height={cellSize - 1}
                fill="black"
                rx="1"
              />
            ) : null
          )
        )}
      </svg>
      {/* WhatsApp icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm">
          <span className="text-lg">📱</span>
        </div>
      </div>
    </div>
  );
}
