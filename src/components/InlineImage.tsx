import { useState } from "react";

interface InlineImageProps {
  src: string;
  alt?: string;
}

/**
 * Inline image component that loads workspace images through the API
 * (WKWebView can't load local file:// paths) and supports click-to-expand.
 */
export function InlineImage({ src, alt = "Image" }: InlineImageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Route local paths through the backend API.
  // Agent outputs /workspace/path or /Users/sovereign/workspace/path.
  let imageSrc = src;
  if (src.startsWith("/workspace/")) {
    imageSrc = `/api/sovereign/workspace/${src.slice("/workspace/".length)}`;
  } else if (src.startsWith("/Users/sovereign/workspace/")) {
    imageSrc = `/api/sovereign/workspace/${src.slice("/Users/sovereign/workspace/".length)}`;
  } else if (src.startsWith("/Users/") && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(src)) {
    imageSrc = `/api/sovereign/workspace/${src.split("/workspace/").pop() || src}`;
  }

  if (hasError) {
    return (
      <div className="my-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700 text-xs text-slate-500">
        ⚠️ Could not load image: {src}
      </div>
    );
  }

  return (
    <>
      <div className="my-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-900/50">
        <div className="relative group">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
              <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
            </div>
          )}
          <img
            src={imageSrc}
            alt={alt}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setHasError(true);
              setIsLoading(false);
            }}
            onClick={() => setIsExpanded(true)}
            className="w-full cursor-pointer transition-transform hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="bg-slate-900/90 px-3 py-1.5 rounded-full text-xs text-white border border-slate-700">
              Click to expand
            </span>
          </div>
        </div>
        {alt && alt !== "Image" && (
          <div className="px-3 py-1.5 bg-slate-900/80 text-[10px] text-slate-400 border-t border-slate-700">
            {alt}
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setIsExpanded(false)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <img
              src={imageSrc}
              alt={alt}
              className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setIsExpanded(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-slate-900/80 border border-slate-700 text-white hover:bg-slate-800 transition-all flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
