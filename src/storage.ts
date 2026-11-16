import {readState, storageKey} from './model'
import {applyAction, newWorkspace, type Action, type Dataset, type Workspace} from './workspace'

declare const __GLUCODEL_SERVER__: boolean
export const hasServer = __GLUCODEL_SERVER__
export type Upload = {type: 'import'; kind: 'cgm' | 'pump'; content: string}
type Result = {workspace: Workspace; imported?: {added: number; duplicates: number}}
export class StorageError extends Error {
  workspace?: Workspace
  constructor(message: string, workspace?: Workspace) {
    super(message)
    this.workspace = workspace
  }
}
const endpoint = (dataset: Dataset) => '/api/' + dataset

export async function readWorkspace(dataset: Dataset): Promise<Workspace> {
  if (!hasServer) return newWorkspace('demo', readState())
  const response = await fetch(endpoint(dataset))
  if (!response.ok) throw new Error('Локальный сервер недоступен.')
  return (await response.json() as Result).workspace
}

export async function writeWorkspace(current: Workspace, action: Action | Upload): Promise<Result> {
  if (!hasServer) {
    if (action.type === 'import') throw new Error('Импорт требует локального сервера.')
    const workspace = applyAction(current, action)
    localStorage.setItem(storageKey, JSON.stringify(workspace.state))
    return {workspace}
  }
  const response = await fetch(endpoint(current.dataset), {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({version: current.version, action}),
  })
  if (!response.ok) {
    const data = await response.json() as {message?: string; workspace?: Workspace}
    throw new StorageError(data.message ?? 'Не удалось сохранить архив.', data.workspace)
  }
  return await response.json() as Result
}
