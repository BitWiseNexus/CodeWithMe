import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders problem text (Markdown + GitHub extensions). Raw HTML in the source
 * is not rendered — react-markdown escapes it — so statements can't inject
 * markup or scripts. Styles live under `.markdown` in globals.css.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
