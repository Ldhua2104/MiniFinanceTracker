import { Fragment } from 'react';

function renderInline(value, keyPrefix = 'inline') {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const parts = value.split(pattern);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={key}>{renderInline(part.slice(2, -2), key)}</strong>;
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={key}>{renderInline(part.slice(2, -2), key)}</del>;
    if (part.startsWith('*') && part.endsWith('*') || part.startsWith('_') && part.endsWith('_')) return <em key={key}>{renderInline(part.slice(1, -1), key)}</em>;
    if (part.startsWith('[')) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        const [, label, href] = match;
        try {
          const parsed = new URL(href, window.location.origin);
          if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return <a key={key} href={href} target="_blank" rel="noreferrer noopener">{renderInline(label, key)}</a>;
        } catch { /* Render unsafe or invalid links as plain text. */ }
        return <Fragment key={key}>{label}</Fragment>;
      }
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function isBlockStart(line) {
  return /^\s*(?:```|#{1,6}\s|>\s?|[-*_]\s*[-*_]\s*[-*_]|[-+*]\s+|\d+\.\s+)/.test(line);
}

export function MarkdownContent({ content }) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
 while (index < lines.length) {
   const line = lines[index];
   if (!line.trim()) { index += 1; continue; }
   if (/^\s*```/.test(line)) {
     const language = line.trim().slice(3).trim();
     index += 1;
     const code = [];
     while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
     if (index < lines.length) index += 1;
     blocks.push(<pre key={`code-${blocks.length}`} data-language={language || undefined}><code>{code.join('\n')}</code></pre>);
     continue;
   }
   const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
   if (heading) {
     const level = heading[1].length;
     const Heading = `h${level}`;
     blocks.push(<Heading key={`heading-${blocks.length}`}>{renderInline(heading[2], `heading-${blocks.length}`)}</Heading>);
     index += 1;
     continue;
   }
   if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
     blocks.push(<hr key={`rule-${blocks.length}`} />);
     index += 1;
     continue;
   }
   if (/^\s*>/.test(line)) {
     const quote = [];
     while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
     blocks.push(<blockquote key={`quote-${blocks.length}`}><MarkdownContent content={quote.join('\n')} /></blockquote>);
     continue;
   }
   const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
   const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
   if (unordered || ordered) {
     const isOrdered = Boolean(ordered);
     const items = [];
     while (index < lines.length) {
       const match = lines[index].match(isOrdered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/);
       if (!match) break;
       items.push(<li key={`item-${items.length}`}>{renderInline(match[1], `list-${blocks.length}-${items.length}`)}</li>);
       index += 1;
     }
     const List = isOrdered ? 'ol' : 'ul';
     blocks.push(<List key={`list-${blocks.length}`}>{items}</List>);
     continue;
   }
   const paragraph = [line.trim()];
   index += 1;
   while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) paragraph.push(lines[index++].trim());
   blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInline(paragraph.join(' '), `paragraph-${blocks.length}`)}</p>);
 }
 return <div className="markdown-content">{blocks}</div>;
}
