import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { RichMessageBlock, parseRichContent } from "../RichMessageBlock";
import { InlineImage } from "../InlineImage";
import { JsonBlock } from "../JsonBlock";

/**
 * Render content that may contain :::canvas blocks or regular markdown.
 */
export function renderContent(content: string) {
  if (content.includes(":::canvas")) {
    const segments = parseRichContent(content);
    return segments.map((segment, i) => {
      if (segment.type === "canvas") {
        return <RichMessageBlock key={`canvas-${i}`} jsonlContent={segment.content} />;
      }
      return <span key={`text-${i}`}>{renderMarkdown(segment.content)}</span>;
    });
  }
  return renderMarkdown(content);
}

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i;
const WORKSPACE_IMAGE_PATH = /(?:^|\s)(\/workspace\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg))/gim;
const ABSOLUTE_IMAGE_PATH = /(?:^|\s)(\/Users\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg))/gim;

/**
 * Pre-process content to convert bare image paths to markdown image syntax.
 * The agent often outputs `/workspace/path/to/image.png` as plain text
 * instead of `![image](/workspace/path/to/image.png)`.
 */
function convertBareImagePaths(content: string): string {
  let result = content;
  result = result.replace(WORKSPACE_IMAGE_PATH, (match, path) => {
    const leading = match.startsWith(' ') || match.startsWith('\n') ? match[0] : '';
    const filename = path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'image';
    return `${leading}![${filename}](${path.trim()})`;
  });
  result = result.replace(ABSOLUTE_IMAGE_PATH, (match, path) => {
    const leading = match.startsWith(' ') || match.startsWith('\n') ? match[0] : '';
    const filename = path.split('/').pop()?.replace(/\.[^.]+$/, '') || 'image';
    return `${leading}![${filename}](${path.trim()})`;
  });
  return result;
}

/**
 * Full ReactMarkdown renderer with custom component overrides.
 */
export function renderMarkdown(content: string) {
  const processed = convertBareImagePaths(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        img: ({ src, alt }) => {
          if (!src) return null;
          return <InlineImage src={src} alt={alt} />;
        },
        code: ({ node, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || "");
          const lang = match ? match[1] : "";
          const inline = !className;

          if (lang === "json" && !inline) {
            try {
              const jsonData = JSON.parse(String(children));
              return <JsonBlock data={jsonData} />;
            } catch {
              // Fall through to regular code block
            }
          }

          if (!inline && lang) {
            return (
              <div className="my-3 rounded-lg overflow-hidden">
                <div className="bg-slate-900 px-3 py-1 text-xs text-slate-400 font-mono border-b border-slate-700">
                  {lang}
                </div>
                <pre className="bg-slate-900/80 p-3 text-sm font-mono text-green-300 overflow-x-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          }

          return inline ? (
            <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono text-blue-300" {...props}>
              {children}
            </code>
          ) : (
            <pre className="bg-slate-900/80 p-3 text-sm font-mono text-green-300 overflow-x-auto rounded-lg my-3">
              <code {...props}>{children}</code>
            </pre>
          );
        },
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="min-w-full border border-slate-700 rounded-lg overflow-hidden">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-slate-800 border-b border-slate-700">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-300 border-r border-slate-700 last:border-r-0">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-xs text-slate-400 border-r border-slate-700 border-b border-slate-800 last:border-r-0">
            {children}
          </td>
        ),
        a: ({ href, children }) => {
          if (href && IMAGE_EXTENSIONS.test(href)) {
            return <InlineImage src={href} alt={String(children) || undefined} />;
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline transition-colors"
            >
              {children}
            </a>
          );
        },
        strong: ({ children }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-slate-300">{children}</em>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-sm text-slate-300">{children}</li>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
