export function shortTicketReference(referenceCode: string): string {
  if (!referenceCode) return ''

  const parts = referenceCode.split('-')
  if (parts.length >= 3 && parts[0] === 'AR') {
    const ts = parts[1]
    const suffix = parts[2]
    const tsTail = ts.slice(-6)
    return `AR-${tsTail}-${suffix}`
  }

  if (referenceCode.length <= 18) return referenceCode
  return `${referenceCode.slice(0, 10)}...${referenceCode.slice(-4)}`
}
