import type { ReactNode } from "react";

/** Inline: `code` and **bold**, as React nodes (never HTML). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("`") ? (
        <code key={`${key}-${i++}`} className="rounded-[4px] bg-muted px-1 py-px font-mono text-[11.5px]">
          {tok.slice(1, -1)}
        </code>
      ) : (
        <strong key={`${key}-${i++}`} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>
      )
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small Markdown preview for skill files: headings, lists, code fences, quotes and paragraphs. */
export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="overflow-x-auto rounded-[8px] bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {body.join("\n")}
        </pre>
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = ["text-[15px]", "text-[13.5px]", "text-[12.5px]"][h[1].length - 1];
      blocks.push(
        <div key={k} className={`${size} mt-1 font-semibold text-foreground`}>
          {inline(h[2], `h${k++}`)}
        </div>
      );
      i++;
      continue;
    }
    const isUl = (l: string) => /^\s*[-*]\s+/.test(l);
    const isOl = (l: string) => /^\s*\d+[.)]\s+/.test(l);
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ""));
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={k} className={`${ordered ? "list-decimal" : "list-disc"} space-y-0.5 ps-5 marker:text-muted-foreground`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `l${k}-${j}`)}</li>
          ))}
        </Tag>
      );
      k++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={k} className="border-s-2 border-border ps-3 text-muted-foreground">
          {inline(quote.join(" "), `q${k++}`)}
        </blockquote>
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]); // (never loop on a line no rule takes)
    blocks.push(<p key={k}>{inline(para.join(" "), `p${k++}`)}</p>);
  }
  return <div className="space-y-2 text-[12.5px] leading-relaxed text-foreground/90">{blocks}</div>;
}
