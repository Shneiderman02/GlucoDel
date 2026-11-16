import {createHash} from 'node:crypto'
import type {CGM, Insulin} from '../src/model.ts'
import type {Observations} from '../src/workspace.ts'

const hour = 3_600_000
const day = 24 * hour
const limit = 1000
const maxBytes = 4 * 1024 * 1024
const label = 'Nightscout'
const bolusTypes = new Set(['Bolus', 'Meal Bolus', 'Correction Bolus', 'Snack Bolus', 'Combo Bolus'])
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
type Row = Record<string, unknown>
type Collection = 'entries' | 'treatments'

export function readNightscoutConfig(env: NodeJS.ProcessEnv) {
  const address = env.NIGHTSCOUT_URL?.trim()
  const token = env.NIGHTSCOUT_READ_TOKEN?.trim()
  if (!address && !token) return undefined
  if (!address || !token || !/^[a-zA-Z0-9_.-]{8,256}$/.test(token)) {
    throw new Error('Укажите NIGHTSCOUT_URL и токен чтения NIGHTSCOUT_READ_TOKEN.')
  }
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new Error('NIGHTSCOUT_URL должен быть адресом сайта Nightscout.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('NIGHTSCOUT_URL должен использовать HTTPS и не содержать логин, пароль, токен или параметры.')
  }
  return {base: new URL(url.href.replace(/\/+$/, '') + '/'), token}
}

function extractTime(row: Row, field: string) {
  if (Number.isSafeInteger(row.date)) return Number(row.date)
  const value = row[field]
  return typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? Date.parse(value) : NaN
}

function extractRows(data: unknown): Row[] {
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Nightscout вернул данные в неожиданном формате.')
  }
  return data as Row[]
}

async function decode(response: Response) {
  if (!response.body) throw new Error('Nightscout вернул пустой ответ.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let length = 0
  let text = ''
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('Ответ Nightscout слишком большой.')
      }
      text += decoder.decode(value, {stream: true})
    }
    try {
      return JSON.parse(text + decoder.decode()) as unknown
    } catch {
      throw new Error('Nightscout вернул ответ, который нельзя прочитать как JSON.')
    }
  } finally {
    reader.releaseLock()
  }
}

export function createNightscout(config: NonNullable<ReturnType<typeof readNightscoutConfig>>, request: typeof fetch = fetch) {
  const sourceId = digest(config.base.href)
  async function windowRows(collection: Collection, start: number, end: number, signal: AbortSignal): Promise<Row[]> {
    const field = collection === 'entries' ? 'date' : 'created_at'
    const url = new URL('api/v1/' + collection + '.json', config.base)
    url.searchParams.set('token', config.token)
    url.searchParams.set('count', String(limit))
    url.searchParams.set('find[' + field + '][$gte]', field === 'date' ? String(start) : new Date(start).toISOString())
    url.searchParams.set('find[' + field + '][$lt]', field === 'date' ? String(end) : new Date(end).toISOString())
    if (collection === 'entries') url.searchParams.set('find[type]', 'sgv')
    let response: Response
    try {
      response = await request(url, {method: 'GET', headers: {Accept: 'application/json'}, redirect: 'error', signal})
    } catch {
      throw new Error('Не удалось связаться с Nightscout. Проверьте адрес и сеть.')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new Error('Nightscout отклонил доступ. Проверьте токен и права чтения.')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error('Nightscout вернул ошибку HTTP ' + response.status + '.')
    }
    const rows = extractRows(await decode(response))
    if (rows.length < limit) return rows
    if (end - start <= 60_000) throw new Error('Слишком много записей Nightscout в одном интервале.')
    const middle = Math.floor((start + end) / 2)
    return [...await windowRows(collection, start, middle, signal), ...await windowRows(collection, middle, end, signal)]
  }

  return {
    sourceId,
    async read(end: number, lastSync?: number) {
      const start = lastSync ? Math.max(end - 14 * day, lastSync - 48 * hour) : end - 14 * day
      const signal = AbortSignal.timeout(60_000)
      const points: CGM[] = []
      const insulin: Insulin[] = []
      const id = (kind: string, value: string | number) => 'ns-' + kind + '-' + digest(sourceId + ':' + value)
      for (let from = Math.min(start, end); from < end; from += day) {
        const to = Math.min(from + day, end)
        const [entries, treatments] = await Promise.all([
          windowRows('entries', from, to, signal),
          windowRows('treatments', from, to, signal),
        ])
        for (const entry of entries) {
          const at = extractTime(entry, 'dateString')
          if (entry.type !== 'sgv' || !Number.isFinite(at) || at < from || at >= to ||
              typeof entry.sgv !== 'number' || !Number.isFinite(entry.sgv) || entry.sgv <= 0 || entry.sgv > 1800) continue
          points.push({id: id('cgm', at), at, received: null, value: entry.sgv / 18.0156, source: label})
        }
        for (const treatment of treatments) {
          const at = extractTime(treatment, 'created_at')
          const key = treatment._id ?? treatment.identifier
          if (!Number.isFinite(at) || at < from || at >= to ||
              typeof key !== 'string' || !key || key.length > 200 || treatment.isValid === false || typeof treatment.eventType !== 'string' || !bolusTypes.has(treatment.eventType) ||
              typeof treatment.insulin !== 'number' || !Number.isFinite(treatment.insulin) || treatment.insulin <= 0) continue
          insulin.push({id: id('insulin', key), at, title: 'Запись о болюсе', type: 'bolus', actual: null,
            reported: treatment.insulin, status: 'reported', mode: 'Не указан', source: label})
        }
      }
      return {points, insulin}
    },
  }
}
export type Nightscout = ReturnType<typeof createNightscout>

export function mergeNightscout(current: Observations, incoming: Awaited<ReturnType<Nightscout['read']>>) {
  let changes = 0
  function merge<T extends {at: number; id: string}>(saved: T[], pulled: T[]) {
    const rows = new Map(saved.map(row => [row.id, row]))
    for (const row of pulled) {
      if (JSON.stringify(rows.get(row.id)) === JSON.stringify(row)) continue
      rows.set(row.id, row)
      changes++
    }
    return [...rows.values()].sort((a, b) => a.at - b.at)
  }
  const observations = {...current, points: merge(current.points, incoming.points), insulin: merge(current.insulin, incoming.insulin)}
  return {observations, changes}
}
