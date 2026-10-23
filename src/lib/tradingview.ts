/** TradingView links. On Android the link opens the TradingView app when it is installed, otherwise the site. */
export type TvMarket = 'crypto' | 'bvb' | 'us'

export function tvSymbol(raw: string, market: TvMarket = 'crypto'): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return ''
  if (s.includes(':')) return s
  if (market === 'bvb') return 'BVB:' + s
  if (market === 'us') return s
  return 'BINANCE:' + (/(USDT|USDC|EUR|BTC)$/.test(s) && s.length > 5 ? s : s + 'USDT')
}

export function tvUrl(raw: string, market: TvMarket = 'crypto', interval?: '240' | 'D' | 'W' | '60'): string {
  const sym = tvSymbol(raw, market)
  const q = new URLSearchParams({ symbol: sym })
  if (interval) q.set('interval', interval)
  return 'https://www.tradingview.com/chart/?' + q.toString()
}
