import type { ReactNode } from "react";
import { parseMiniMarkdown, type MdInline } from "@/lib/mini-markdown";

function inline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((n, i) =>
    typeof n === "string" ? n
    : n.type === "strong" ? <strong key={i} className="font-semibold">{inline(n.children)}</strong>
    : <em key={i}>{inline(n.children)}</em>,
  );
}

// Renders the notice markdown subset (contract §3.1.7). Every piece of text goes through React as a
// string, so it is escaped: a stray `<` is a character, never markup.
export function MiniMarkdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {parseMiniMarkdown(text).map((block, i) =>
        block.type === "p" ? (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>{j > 0 && <br />}{inline(line)}</span>
            ))}
          </p>
        ) : (
          <ul key={i} className="list-disc pl-4 flex flex-col gap-0.5">
            {block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}
