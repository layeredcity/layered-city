// Finger-in-the-wind currency conversion for the city "cheat sheet" card.
// One free, no-key call to open.er-api.com returns USD → every currency; we
// cache it for the day (rates refresh ~daily) and convert locally. Deliberately
// approximate — it's a travel-planning gut check, not a trading tool.

// City content has a `country` (countryName). Map each country we cover to its
// ISO 4217 code. England/Scotland → GBP; euro countries share EUR. Add a row
// here when a new country's city is added.
const COUNTRY_CURRENCY = {
  Austria: 'EUR',
  Belgium: 'EUR',
  Czechia: 'CZK',
  Denmark: 'DKK',
  England: 'GBP',
  Finland: 'EUR',
  France: 'EUR',
  Germany: 'EUR',
  Greece: 'EUR',
  Hungary: 'HUF',
  Iceland: 'ISK',
  Ireland: 'EUR',
  Italy: 'EUR',
  Netherlands: 'EUR',
  Norway: 'NOK',
  Poland: 'PLN',
  Portugal: 'EUR',
  Romania: 'RON',
  Scotland: 'GBP',
  Serbia: 'RSD',
  Spain: 'EUR',
  Sweden: 'SEK',
  Switzerland: 'CHF',
  Türkiye: 'TRY',
  Turkey: 'TRY',
}

export function currencyForCountry(country) {
  return COUNTRY_CURRENCY[country] || null
}

const LS_KEY = 'lc_usd_rates_v1'
let pending = null

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

// Resolves to { rates, date, day } or null. Cached in localStorage for the day
// and memoised in-module so a session makes at most one network call.
export function fetchUsdRates() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (cached && cached.day === todayKey() && cached.rates) return Promise.resolve(cached)
  } catch { /* ignore corrupt cache */ }

  if (pending) return pending
  pending = fetch('https://open.er-api.com/v6/latest/USD')
    .then(r => r.json())
    .then(j => {
      if (j.result !== 'success' || !j.rates) throw new Error('rates unavailable')
      const data = {
        rates: j.rates,
        date: (j.time_last_update_utc || '').replace(/\s\d\d:\d\d:\d\d.*$/, ''),
        day: todayKey(),
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch { /* private mode, etc. */ }
      return data
    })
    .catch(() => null)
    .finally(() => { pending = null })
  return pending
}
