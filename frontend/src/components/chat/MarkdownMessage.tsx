import React from 'react'

interface MarkdownMessageProps {
  content: string
}

const INLINE_TOKEN =
  /(\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<]+)|(\+?\d[\d\s().-]{7,}\d)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|\*\*([^*]+)\*\*|\*([^*]+)\*)/gi

const normalizeStructuredContent = (content: string): string => {
  return content
    .replace(/:\s+(\d+\.\s)/g, ':\n$1')
    .replace(/\s+(\d+\.\s)/g, '\n$1')
    .replace(/\.\s+(Note that|Important:|Please note|However,|Also,)/g, '.\n\n$1')
    .trim()
}

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
      const rawUrl = match[4]
      const trimmedUrl = rawUrl.replace(/[),.;!?]+$/, '')
      const trailing = rawUrl.slice(trimmedUrl.length)
      const href = trimmedUrl.startsWith('www.') ? `https://${trimmedUrl}` : trimmedUrl
      nodes.push(
        <React.Fragment key={`url-${key}`}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800 break-all"
          >
            {trimmedUrl}
          </a>
          {trailing}
        </React.Fragment>
      )
    } else if (match[5]) {
      const rawPhone = match[5]
      const trimmedPhone = rawPhone.replace(/[),.;!?]+$/, '')
      const trailing = rawPhone.slice(trimmedPhone.length)
      const telValue = trimmedPhone.replace(/[^\d+]/g, '')
      nodes.push(
        <React.Fragment key={`phone-${key}`}>
          <a
            href={`tel:${telValue}`}
            className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800"
          >
            {trimmedPhone}
          </a>
          {trailing}
        </React.Fragment>
      )
    } else if (match[6]) {
      nodes.push(
        <a
          key={`email-${key}`}
          href={`mailto:${match[6]}`}
          className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800"
        >
          {match[6]}
        </a>
      )
    } else if (match[7]) {
      nodes.push(
        <strong key={`strong-${key}`} className="font-semibold text-slate-900">
          {match[7]}
        </strong>
      )
    } else if (match[8]) {
      nodes.push(
        <em key={`em-${key}`} className="italic">
          {match[8]}
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
  const normalizedContent = normalizeStructuredContent(content)
  const lines = normalizedContent.split(/\r?\n/)
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

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index].trim()
        if (!/^[-*]\s+/.test(current)) {
          break
        }
        items.push(current.replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${index}`} className="ml-5 list-disc space-y-2">
          {items.map((item, itemIndex) => (
            <li key={`bullet-${index}-${itemIndex}`} className="pl-1">
              {parseInline(item)}
            </li>
          ))}
        </ul>
      )
      continue
    }

    const paragraphLines = [rawLine]
    index += 1
    while (index < lines.length) {
      const currentRaw = lines[index]
      const current = currentRaw.trim()
      if (
        !current ||
        /^(\*{3,}|-{3,})$/.test(current) ||
        /^(#{1,6})\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        /^[-*]\s+/.test(current)
      ) {
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
