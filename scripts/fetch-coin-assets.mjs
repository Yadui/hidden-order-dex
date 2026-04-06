#!/usr/bin/env node
/**
 * fetch-coin-assets.mjs
 *
 * Downloads the top 250 coin icons from CoinGecko and saves them to
 * frontend/public/coins/<id>.png
 *
 * Also writes frontend/src/assets/coinManifest.json:
 *   { [sym]: { id, name, mockPrice, localIcon: "/coins/<id>.png" } }
 *
 * Usage:  node scripts/fetch-coin-assets.mjs
 *         npm run fetch:coins
 */

import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const COINS_DIR = path.join(ROOT, 'frontend', 'public', 'coins')
const MANIFEST  = path.join(ROOT, 'frontend', 'src', 'assets', 'coinManifest.json')

fs.mkdirSync(COINS_DIR, { recursive: true })
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true })

// ── helpers ────────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HiddenOrderDEX/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject)
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── fetch coin list (top 250 by market cap) ───────────────────────────────────
async function fetchMarkets(page) {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=125&page=${page}&sparkline=false`
  const { status, body } = await get(url)
  if (status !== 200) throw new Error(`CoinGecko markets API returned ${status}`)
  return JSON.parse(body.toString())
}

// ── download one image ─────────────────────────────────────────────────────────
async function downloadImage(url, dest) {
  if (fs.existsSync(dest)) return false   // already cached
  const { status, body } = await get(url)
  if (status !== 200) throw new Error(`${status} for ${url}`)
  fs.writeFileSync(dest, body)
  return true
}

// ── main ───────────────────────────────────────────────────────────────────────
;(async () => {
  console.log('Fetching top 250 coins from CoinGecko…')

  let coins = []
  for (const page of [1, 2]) {
    try {
      const batch = await fetchMarkets(page)
      coins = coins.concat(batch)
      console.log(`  page ${page}: ${batch.length} coins`)
      await sleep(1200)   // respect free-tier rate limit
    } catch (err) {
      console.error(`  page ${page} failed: ${err.message}`)
    }
  }

  console.log(`\nDownloading ${coins.length} icons to frontend/public/coins/ …`)

  const manifest = {}
  let downloaded = 0
  let skipped    = 0
  let failed     = 0

  for (const coin of coins) {
    const sym  = coin.symbol.toUpperCase()
    const dest = path.join(COINS_DIR, `${coin.id}.png`)
    const localIcon = `/coins/${coin.id}.png`

    if (!manifest[sym]) {
      manifest[sym] = {
        id:         coin.id,
        name:       coin.name,
        mockPrice:  coin.current_price ?? null,
        localIcon,
      }
    }

    const imgUrl = coin.image?.replace('/large/', '/small/')   // smaller = faster
    if (!imgUrl) { skipped++; continue }

    try {
      const fresh = await downloadImage(imgUrl, dest)
      fresh ? downloaded++ : skipped++
      process.stdout.write(fresh ? '.' : 's')
    } catch {
      failed++
      process.stdout.write('x')
    }

    await sleep(25)   // avoid hammering CDN
  }

  console.log(`\n\nDone.`)
  console.log(`  Downloaded : ${downloaded}`)
  console.log(`  Skipped    : ${skipped} (already cached)`)
  console.log(`  Failed     : ${failed}`)

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  console.log(`  Manifest   : frontend/src/assets/coinManifest.json (${Object.keys(manifest).length} entries)`)
})()
