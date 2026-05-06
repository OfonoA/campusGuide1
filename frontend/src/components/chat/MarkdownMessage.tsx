import React from 'react'

interface MarkdownMessageProps {
  content: string
}

const INLINE_TOKEN = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g

const parseInline = (text: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`link-${key}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800"
        >
          {match[2]}
        </a>
      )
    } else if (match[4]) {
      nodes.push(
        <strong key={`strong-${key}`} className="font-semibold text-slate-900">
          {match[4]}
        </strong>
      )
    } else if (match[5]) {
      nodes.push(
        <em key={`em-${key}`} className="italic">
          {match[5]}
        </em>
      )
    }

    lastIndex = index + match[0].length
    key += 1
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  const lines = content.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const rawLine = lines[index]
    const line = rawLine.trim()

    if (!line) {
      index += 1
      continue
    }

    if (/^(\*{3,}|-{3,})$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="border-slate-200" />)
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6)
      const headingText = headingMatch[2]
      const HeadingTag = `h${level}` as React.ElementType
      const headingClass =
        level <= 2
          ? 'text-base font-semibold text-slate-950'
          : 'text-sm font-semibold uppercase tracking-[0.08em] text-slate-700'
      blocks.push(
        <HeadingTag key={`heading-${index}`} className={headingClass}>
          {parseInline(headingText)}
        </HeadingTag>
      )
      index += 1
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        if (!/^\d+\.\s+/.test(current)) {
          break
        }
        items.push(current.replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`list-${index}`} className="ml-5 list-decimal space-y-2">
          {items.map((item, itemIndex) => (
            <li key={`item-${index}-${itemIndex}`} className="pl-1">
              {parseInline(item)}
            </li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines = [rawLine]
    index += 1
    while (index < lines.length) {
      const currentRaw = lines[index]
      const current = currentRaw.trim()
      if (!current || /^(\*{3,}|-{3,})$/.test(current) || /^(#{1,6})\s+/.test(current) || /^\d+\.\s+/.test(current)) {
        break
      }
      paragraphLines.push(currentRaw)
      index += 1
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="whitespace-pre-wrap break-words">
        {parseInline(paragraphLines.join('\n'))}
      </p>
    )
  }

  return <div className="space-y-3">{blocks}</div>
}

export default MarkdownMessage
