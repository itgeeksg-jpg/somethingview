// Symbol resolution: turns whatever the user typed (TradingView-style names,
// Yahoo tickers, Binance pairs) into a data source + provider symbol.

// name -> [yahooSymbol, description, type]
export const ALIASES = {
  SPX: ['^GSPC', 'S&P 500 Index', 'index'],
  DJI: ['^DJI', 'Dow Jones Industrial Average', 'index'],
  NDX: ['^NDX', 'Nasdaq 100 Index', 'index'],
  IXIC: ['^IXIC', 'Nasdaq Composite', 'index'],
  RUT: ['^RUT', 'Russell 2000', 'index'],
  VIX: ['^VIX', 'CBOE Volatility Index', 'index'],
  DXY: ['DX-Y.NYB', 'U.S. Dollar Index', 'index'],
  US10Y: ['^TNX', 'US 10 Year Treasury Yield', 'bond'],
  US30Y: ['^TYX', 'US 30 Year Treasury Yield', 'bond'],
  US05Y: ['^FVX', 'US 5 Year Treasury Yield', 'bond'],
  US03M: ['^IRX', 'US 13 Week Treasury Bill', 'bond'],
  HSI: ['^HSI', 'Hang Seng Index', 'index'],
  NI225: ['^N225', 'Nikkei 225', 'index'],
  KOSPI: ['^KS11', 'KOSPI Composite', 'index'],
  STI: ['^STI', 'Straits Times Index', 'index'],
  '000300': ['000300.SS', 'CSI 300 Index', 'index'],
  SHCOMP: ['000001.SS', 'SSE Composite', 'index'],
  TWII: ['^TWII', 'Taiwan Weighted', 'index'],
  XJO: ['^AXJO', 'S&P/ASX 200', 'index'],
  NIFTY: ['^NSEI', 'Nifty 50', 'index'],
  SENSEX: ['^BSESN', 'BSE Sensex', 'index'],
  DAX: ['^GDAXI', 'DAX', 'index'],
  UKX: ['^FTSE', 'FTSE 100', 'index'],
  FTSE: ['^FTSE', 'FTSE 100', 'index'],
  CAC40: ['^FCHI', 'CAC 40', 'index'],
  SX5E: ['^STOXX50E', 'Euro Stoxx 50', 'index'],
  KLCI: ['^KLSE', 'FTSE Bursa Malaysia KLCI', 'index'],
  JCI: ['^JKSE', 'Jakarta Composite', 'index'],
  XAUUSD: ['GC=F', 'Gold (front-month futures)', 'commodity'],
  GOLD: ['GC=F', 'Gold (front-month futures)', 'commodity'],
  XAGUSD: ['SI=F', 'Silver (front-month futures)', 'commodity'],
  SILVER: ['SI=F', 'Silver (front-month futures)', 'commodity'],
  PLATINUM: ['PL=F', 'Platinum futures', 'commodity'],
  COPPER: ['HG=F', 'Copper futures', 'commodity'],
  USOIL: ['CL=F', 'WTI Crude Oil', 'commodity'],
  WTI: ['CL=F', 'WTI Crude Oil', 'commodity'],
  UKOIL: ['BZ=F', 'Brent Crude Oil', 'commodity'],
  BRENT: ['BZ=F', 'Brent Crude Oil', 'commodity'],
  NATGAS: ['NG=F', 'Natural Gas', 'commodity'],
};

const CRYPTO_NAMES = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', ADA: 'Cardano', DOGE: 'Dogecoin', XMR: 'Monero',
  BCH: 'Bitcoin Cash', LTC: 'Litecoin', TON: 'Toncoin', HYPE: 'Hyperliquid', AVAX: 'Avalanche', DOT: 'Polkadot',
  LINK: 'Chainlink', TRX: 'TRON', BNB: 'BNB', SUI: 'Sui', PEPE: 'Pepe', SHIB: 'Shiba Inu', UNI: 'Uniswap',
  ATOM: 'Cosmos', XLM: 'Stellar', ETC: 'Ethereum Classic', NEAR: 'NEAR', APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism',
  FIL: 'Filecoin', ICP: 'Internet Computer', HBAR: 'Hedera', VET: 'VeChain', ALGO: 'Algorand', AAVE: 'Aave',
  INJ: 'Injective', RENDER: 'Render', SEI: 'Sei', TIA: 'Celestia', WIF: 'dogwifhat', BONK: 'Bonk', FET: 'Fetch.ai',
  TAO: 'Bittensor', KAS: 'Kaspa', STX: 'Stacks', IMX: 'Immutable', GRT: 'The Graph', ENA: 'Ethena', ONDO: 'Ondo',
  JUP: 'Jupiter', PYTH: 'Pyth', WLD: 'Worldcoin', POL: 'Polygon', ZEC: 'Zcash', DASH: 'Dash', XTZ: 'Tezos',
  EOS: 'EOS', SAND: 'The Sandbox', MANA: 'Decentraland', CRV: 'Curve', LDO: 'Lido', RUNE: 'THORChain', PAXG: 'PAX Gold',
  USDC: 'USD Coin', USDT: 'Tether', FDUSD: 'First Digital USD',
};
const QUOTE_NAMES = { USDT: 'TetherUS', USDC: 'USD Coin', FDUSD: 'First Digital USD', USD: 'U.S. Dollar', BTC: 'Bitcoin', ETH: 'Ethereum', EUR: 'Euro', SGD: 'Singapore Dollar', BNB: 'BNB', TRY: 'Turkish Lira', JPY: 'Japanese Yen', GBP: 'British Pound', AUD: 'Australian Dollar', BRL: 'Brazilian Real' };

const FIAT = {
  USD: 'U.S. Dollar', EUR: 'Euro', JPY: 'Japanese Yen', GBP: 'British Pound', AUD: 'Australian Dollar', CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc', CNY: 'Chinese Yuan', CNH: 'Chinese Yuan (offshore)', HKD: 'Hong Kong Dollar', NZD: 'New Zealand Dollar',
  SGD: 'Singapore Dollar', MYR: 'Malaysian Ringgit', THB: 'Thai Baht', IDR: 'Indonesian Rupiah', PHP: 'Philippine Peso',
  INR: 'Indian Rupee', KRW: 'South Korean Won', TWD: 'Taiwan Dollar', VND: 'Vietnamese Dong', SEK: 'Swedish Krona',
  NOK: 'Norwegian Krone', DKK: 'Danish Krone', PLN: 'Polish Zloty', MXN: 'Mexican Peso', BRL: 'Brazilian Real',
  ZAR: 'South African Rand', TRY: 'Turkish Lira', RUB: 'Russian Ruble', AED: 'UAE Dirham', SAR: 'Saudi Riyal', ILS: 'Israeli Shekel',
};

const BINANCE_QUOTES = ['FDUSD', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY', 'TUSD', 'DAI'];

// TradingView exchange prefix -> Yahoo suffix
const EXCHANGE_SUFFIX = {
  SGX: '.SI', HKEX: '.HK', TSE: '.T', LSE: '.L', ASX: '.AX', TSX: '.TO', TSXV: '.V', XETR: '.DE', FWB: '.F',
  EURONEXT: '.PA', NSE: '.NS', BSE: '.BO', KRX: '.KS', TWSE: '.TW', SSE: '.SS', SZSE: '.SZ', MYX: '.KL',
  SET: '.BK', IDX: '.JK', SIX: '.SW', OMXSTO: '.ST', MIL: '.MI', BME: '.MC', NZX: '.NZ',
};
const CRYPTO_EXCHANGES = new Set(['BITFINEX', 'COINBASE', 'BITSTAMP', 'KRAKEN', 'GEMINI', 'BYBIT', 'OKX', 'CRYPTO', 'INDEX',
  'BINANCEUS', 'MEXC', 'KUCOIN', 'BITGET', 'PYTH', 'CRYPTOCOM', 'HTX', 'GATEIO', 'BITMEX', 'DERIBIT', 'UPBIT']);

export function splitBinance(sym) {
  for (const q of BINANCE_QUOTES) {
    if (sym.endsWith(q) && sym.length > q.length) return [sym.slice(0, -q.length), q];
  }
  return [sym, ''];
}

function cryptoPair(s) {
  // BTCUSD, ETHBTC, BTCSGD... (base must be a known coin)
  const m = s.match(/^([A-Z0-9]{2,6}?)(USD|EUR|SGD|GBP|JPY|AUD|CAD|KRW|BTC|ETH)$/);
  if (m && CRYPTO_NAMES[m[1]] && m[1] !== m[2]) return [m[1], m[2]];
  return null;
}

// Returns { key, display, src: 'binance'|'yahoo', sym, desc, type }
export function resolve(raw) {
  const key = String(raw).trim().toUpperCase();
  let s = key;
  let ex = '';
  if (s.includes(':')) [ex, s] = s.split(':', 2);

  if (ex === 'BINANCE' || ex === 'BINANCEUS') {
    const [b, q] = splitBinance(s);
    return { key, display: s, src: 'binance', sym: s, type: 'crypto', exchange: 'Binance',
      desc: `${CRYPTO_NAMES[b] || b} / ${QUOTE_NAMES[q] || q}` };
  }
  if (ex === 'YAHOO') return { key, display: s, src: 'yahoo', sym: s, type: '', exchange: '', desc: '' };

  if (ALIASES[s]) {
    const [y, desc, type] = ALIASES[s];
    return { key, display: s, src: 'yahoo', sym: y, desc, type, exchange: '' };
  }
  const fut = s.match(/^([A-Z0-9]{1,4})1!$/);
  if (fut) return { key, display: s, src: 'yahoo', sym: `${fut[1]}=F`, desc: `${fut[1]} continuous futures`, type: 'futures', exchange: '' };

  if (ex && CRYPTO_EXCHANGES.has(ex) && /(USDT|USDC|FDUSD)$/.test(s)) return resolve('BINANCE:' + s);
  if (!ex || CRYPTO_EXCHANGES.has(ex)) {
    if (/^[A-Z0-9]{2,12}(USDT|USDC|FDUSD)$/.test(s)) return resolve('BINANCE:' + s);
    const cp = cryptoPair(s);
    if (cp) return { key, display: s, src: 'yahoo', sym: `${cp[0]}-${cp[1]}`, type: 'crypto', exchange: '',
      desc: `${CRYPTO_NAMES[cp[0]]} / ${QUOTE_NAMES[cp[1]] || cp[1]}` };
  }
  if (/^[A-Z]{6}$/.test(s) && FIAT[s.slice(0, 3)] && FIAT[s.slice(3)]) {
    return { key, display: s, src: 'yahoo', sym: `${s}=X`, type: 'forex', exchange: 'FX',
      desc: `${FIAT[s.slice(0, 3)]} / ${FIAT[s.slice(3)]}` };
  }
  if (ex && EXCHANGE_SUFFIX[ex]) {
    let t = s;
    if (ex === 'HKEX' && /^\d+$/.test(t)) t = t.padStart(4, '0');
    return { key, display: s, src: 'yahoo', sym: t + EXCHANGE_SUFFIX[ex], type: 'stock', exchange: ex, desc: '' };
  }
  // Plain Yahoo ticker: AAPL, D05.SI, ^GSPC, BTC-USD, GC=F, BRK.B -> BRK-B
  let y = s;
  if (/^[A-Z]{1,5}\.[ABC]$/.test(y)) y = y.replace('.', '-');
  return { key, display: s, src: 'yahoo', sym: y, desc: '', type: '', exchange: ex || '' };
}

export function aliasMatches(q) {
  q = q.toUpperCase();
  const out = [];
  for (const [k, [y, desc, type]] of Object.entries(ALIASES)) {
    if (k.startsWith(q) || desc.toUpperCase().includes(q)) out.push({ key: k, desc, type, exchange: y });
  }
  return out;
}

export function cryptoBase(r) {
  if (r.type !== 'crypto') return null;
  if (r.src === 'binance') return splitBinance(r.sym)[0];
  return r.sym.split('-')[0];
}

export function avatarText(r) {
  const base = cryptoBase(r);
  if (base) return base.slice(0, 1);
  const d = r.display.replace(/^[\^0-9]+/, '');
  return (d[0] || r.display[0] || '?');
}

export function icon(r) {
  const base = cryptoBase(r);
  if (base) return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${base.toLowerCase()}.png`;
  return null;
}
