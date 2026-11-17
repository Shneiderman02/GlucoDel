import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {applyAction, newWorkspace, type Action, type Dataset, type Workspace, type NightscoutStatus} from '../src/workspace.ts'
import {mergeImport, type ImportKind} from './import.ts'
import {insertCgmGaps} from '../src/model.ts'
import {mergeNightscout, type Nightscout} from './nightscout.ts'

type SavedWorkspace = Workspace & {nightscoutImport?: {sourceId: string; lastSuccess: number; changed: number}}

type Command = {version: number; action: Action | {type: 'import'; kind: ImportKind; content: string}}
const maxBytes = 8 * 1024 * 1024

function response(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
  res.end(JSON.stringify(data))
}

async function readCommand(req: IncomingMessage): Promise<Command> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const part of req as AsyncIterable<Buffer>) {
    size += part.length
    if (size <= maxBytes) chunks.push(part)
  }
  if (size > maxBytes) throw new Error('Файл слишком большой. Допустимо до 8 МБ на запрос.')
  let body: Command
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Command
  } catch {
    throw new Error('Некорректный JSON.')
  }
  if (!body || !Number.isInteger(body.version) || !body.action || typeof body.action !== 'object') {
    throw new Error('Нужны версия архива и действие.')
  }
  return body
}

export function createApi(path: string, nightscout?: Nightscout, interval = 5 * 60_000, study?: Workspace) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE IF NOT EXISTS workspaces (name TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)')
  const read = db.prepare('SELECT version, data FROM workspaces WHERE name = ?')
  const create = db.prepare('INSERT OR IGNORE INTO workspaces (name, version, data) VALUES (?, 0, ?)')
  const write = db.prepare('UPDATE workspaces SET data = ?, version = ? WHERE name = ? AND version = ?')
  if (study) {
    create.run('study', JSON.stringify(study))
    if (study.replayPeriod) {
      db.prepare(`UPDATE workspaces SET data = ?, version = 0
        WHERE name = 'study' AND json_extract(data, '$.replayPeriod') IS NULL`).run(JSON.stringify(study))
    }
  }
  const get = (dataset: Dataset) => {
    let row = read.get(dataset)
    if (!row) {
      create.run(dataset, JSON.stringify(newWorkspace(dataset)))
      row = read.get(dataset)
    }
    return JSON.parse(row!.data as string) as SavedWorkspace
  }
  let inFlight: Promise<boolean> | undefined
  let syncError: string | undefined
  let disposed = false
  const sync = () => {
    if (inFlight) return inFlight
    if (!nightscout || disposed) return Promise.resolve(false)
    const doSync = async () => {
      const current = get('archive')
      if (current.nightscoutImport && current.nightscoutImport.sourceId !== nightscout.sourceId) {
        throw new Error('Этот архив уже связан с другим Nightscout. Для другого источника нужен отдельный архив.')
      }
      const end = Date.now()
      const incoming = await nightscout.read(end, current.nightscoutImport?.lastSuccess)
      if (disposed) return false
      const latest = get('archive')
      if (latest.nightscoutImport && latest.nightscoutImport.sourceId !== nightscout.sourceId) {
        throw new Error('Архив уже связан с другим Nightscout.')
      }
      const {observations, changes} = mergeNightscout(latest.observations, incoming)
      const next: SavedWorkspace = {...latest, observations, version: latest.version + 1,
        nightscoutImport: {sourceId: nightscout.sourceId, lastSuccess: end, changed: changes}}
      if (!write.run(JSON.stringify(next), next.version, 'archive', latest.version).changes) {
        throw new Error('Архив изменился во время синхронизации. Повторите попытку.')
      }
      syncError = undefined
      return true
    }
    inFlight = doSync().catch(error => {
      syncError = error instanceof Error && !(error instanceof DOMException) && !('code' in error)
        ? error.message : 'Не удалось завершить синхронизацию Nightscout.'
      return false
    }).finally(() => {inFlight = undefined})
    return inFlight
  }
  const forClient = ({nightscoutImport, ...workspace}: SavedWorkspace): Workspace => {
    if (workspace.dataset === 'study') {
      return {...workspace, observations: {
        ...workspace.observations, points: insertCgmGaps(workspace.observations.points),
      }}
    }
    if (workspace.dataset !== 'archive') return workspace
    const latestMeasurement = workspace.observations.points.findLast(point => point.value !== null && point.id.startsWith('ns-cgm-'))?.at
    const status: NightscoutStatus = {configured: !!nightscout, syncing: !!inFlight, lastSuccess: nightscoutImport?.lastSuccess,
      latestMeasurement, changed: nightscoutImport?.changed, error: syncError}
    // At an identical timestamp, prefer the explicitly imported CSV measurement.
    const uniquePoints = new Map<number, typeof workspace.observations.points[number]>()
    for (const point of workspace.observations.points) {
      const previous = uniquePoints.get(point.at)
      if (!previous || (point.value !== null && !point.id.startsWith('ns-cgm-')) || previous.value === null) uniquePoints.set(point.at, point)
    }
    return {...workspace, nightscout: status, observations: {...workspace.observations, points: insertCgmGaps([...uniquePoints.values()])}}
  }
  const server = createServer((req, res) => {
    void (async () => {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return response(res, 403, {message: 'Локальный адрес обязателен.'})
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const syncRoute = url.pathname === '/api/archive/nightscout'
      const dataset = url.pathname === '/api/demo' ? 'demo' : url.pathname === '/api/archive' || syncRoute ? 'archive'
        : url.pathname === '/api/study' ? 'study' : null
      if (!dataset) return response(res, 404, {message: 'Маршрут не найден.'})
      if (dataset === 'study') {
        if (!read.get(dataset)) return response(res, 404, {message: 'Выборка AZT1D ещё не загружена.'})
        if (req.method === 'POST' && !get(dataset).replayPeriod) {
          return response(res, 405, {message: 'Исследовательские записи доступны только для чтения.'})
        }
      }
      if (req.method === 'GET' && !syncRoute) return response(res, 200, {workspace: forClient(get(dataset))})
      if (req.method !== 'POST') return response(res, 405, {message: 'Поддерживаются GET и POST.'})
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return response(res, 415, {message: 'Ожидается application/json.'})
      const origin = req.headers.origin
      if (origin && origin !== 'http://' + req.headers.host) return response(res, 403, {message: 'Запрос с постороннего сайта отклонён.'})
      if (syncRoute) {
        if (!nightscout) return response(res, 503, {message: 'Настройте Nightscout в локальном файле .env.local.'})
        const ok = await sync()
        const workspace = forClient(get('archive'))
        return response(res, ok ? 200 : 502, {workspace, message: ok ? undefined : syncError})
      }
      let command: Command
      try {
        command = await readCommand(req)
      } catch (error) {
        return response(res, 400, {message: (error as Error).message})
      }
      const current = get(dataset)
      if (current.version !== command.version) return response(res, 409, {message: 'Архив изменён в другой вкладке. Проверьте обновлённые записи и повторите действие.', workspace: forClient(current)})
      let next: Workspace
      let imported: {added: number; duplicates: number} | undefined
      const action = command.action
      try {
        if (action.type === 'import') {
          if (dataset !== 'archive' || (action.kind !== 'cgm' && action.kind !== 'pump') || typeof action.content !== 'string') {
            throw new Error('Импорт доступен только в локальном архиве. Выберите выгрузку CGM или помпы.')
          }
          const {result, added, duplicates} = mergeImport(current.observations, action.kind, action.content)
          imported = {added, duplicates}
          next = added ? {...current, observations: result} : current
        } else {
          next = applyAction(current, action)
        }
      } catch (error) {
        return response(res, 400, {message: (error as Error).message})
      }
      if (next !== current) {
        next = {...next, version: current.version + 1}
        if (!write.run(JSON.stringify(next), next.version, dataset, current.version).changes) {
          return response(res, 409, {message: 'Архив изменён. Повторите действие.', workspace: forClient(get(dataset))})
        }
      }
      return response(res, 200, {workspace: forClient(next), imported})
    })().catch(error => {
      console.error('Local API request failed:', error instanceof Error ? error.name : 'unknown')
      if (!res.headersSent) response(res, 500, {message: 'Не удалось открыть или сохранить локальный архив.'})
    })
  })
  let timer: NodeJS.Timeout | undefined
  let initial: NodeJS.Timeout | undefined
  if (nightscout && interval > 0) {
    server.once('listening', () => {
      initial = setTimeout(() => {void sync()}, 250)
      timer = setInterval(() => {void sync()}, interval)
    })
  }
  server.once('close', () => {
    disposed = true
    clearTimeout(initial)
    clearInterval(timer)
    db.close()
  })
  return server
}
