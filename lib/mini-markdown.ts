// The markdown subset a `notice` may use (contract §3.1.7), and nothing else: `**bold**`, `*italic*`,
// lines starting with `- ` as a bullet list, single line breaks, and a blank line between paragraphs.
// No links, images, headings, HTML, code or tables: anything outside the subset stays as literal
// characters, which is why this is not a general markdown library (it would parse those and drop
// their characters). The result is a tree of strings, so the renderer escapes everything by
// construction: a stray `<` is only ever a character.

export type MdInline = string | { type: "strong" | "em"; children: MdInline[] };
export type MdBlock =
  | { type: "p"; lines: MdInline[][] }
  | { type: "ul"; items: MdInline[][] };

// `**…**` first, then `*…*`. The content has to start and end on a non-space, so "2 * 3 * 4" is
// arithmetic, not italics, and an unmatched `*` stays a `*`.
const BOLD = /\*\*(\S(?:[\s\S]*?\S)?)\*\*/g;
const ITALIC = /\*(\S(?:[^*\n]*?\S)?)\*/g;

function italics(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(ITALIC)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ type: "em", children: [m[1]] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    if (m.index! > last) out.push(...italics(text.slice(last, m.index)));
    out.push({ type: "strong", children: italics(m[1]) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...italics(text.slice(last)));
  return out;
}

export function parseMiniMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.length) blocks.push({ type: "p", lines: para.map(parseInline) }); para = []; };
  const flushList = () => { if (list.length) blocks.push({ type: "ul", items: list.map(parseInline) }); list = []; };

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) { flushPara(); flushList(); continue; }          // a blank line ends a paragraph or list
    if (line.startsWith("- ")) { flushPara(); list.push(line.slice(2)); continue; }
    flushList();
    para.push(line);                                                     // a single line break stays a break
  }
  flushPara();
  flushList();
  return blocks;
}
