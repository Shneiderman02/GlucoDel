import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {applyAction, newWorkspace, type Action, type Dataset, type Workspace} from '../src/workspace.ts'
import {insertCgmGaps, mergeImport, type ImportKind} from './import.ts'

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

export function createApi(path: string) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE IF NOT EXISTS workspaces (name TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL)')
  const read = db.prepare('SELECT version, data FROM workspaces WHERE name = ?')
  const create = db.prepare('INSERT OR IGNORE INTO workspaces (name, version, data) VALUES (?, 0, ?)')
  const write = db.prepare('UPDATE workspaces SET data = ?, version = ? WHERE name = ? AND version = ?')
  const get = (dataset: Dataset) => {
    let row = read.get(dataset)
    if (!row) {
      create.run(dataset, JSON.stringify(newWorkspace(dataset)))
      row = read.get(dataset)
    }
    return JSON.parse(row!.data as string) as Workspace
  }
  const forClient = (workspace: Workspace) => workspace.dataset === 'archive'
    ? {...workspace, observations: {...workspace.observations, points: insertCgmGaps(workspace.observations.points)}}
    : workspace
  const server = createServer((req, res) => {
    void (async () => {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return response(res, 403, {message: 'Локальный адрес обязателен.'})
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const dataset = url.pathname === '/api/demo' ? 'demo' : url.pathname === '/api/archive' ? 'archive' : null
      if (!dataset) return response(res, 404, {message: 'Маршрут не найден.'})
      if (req.method === 'GET') return response(res, 200, {workspace: forClient(get(dataset))})
      if (req.method !== 'POST') return response(res, 405, {message: 'Поддерживаются GET и POST.'})
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return response(res, 415, {message: 'Ожидается application/json.'})
      const origin = req.headers.origin
      if (origin && origin !== 'http://' + req.headers.host) return response(res, 403, {message: 'Запрос с постороннего сайта отклонён.'})
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
  server.once('close', () => db.close())
  return server
}
