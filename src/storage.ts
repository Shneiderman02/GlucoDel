import {readState, storageKey, insertCgmGaps, studyCgmSource, type Meal, type Insulin, type State} from './model'
import {applyAction, newWorkspace, validateMeal, type Action, type Dataset, type Workspace} from './workspace'

declare const __GLUCODEL_SERVER__: boolean
export const hasServer = __GLUCODEL_SERVER__
export async function syncNightscout(): Promise<Workspace> {
  const response = await fetch('/api/archive/nightscout', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}' })
  const data = await response.json() as Result & {message?: string}
  if (!response.ok) throw new StorageError(data.message ?? 'Не удалось синхронизировать Nightscout.', data.workspace)
  return data.workspace
}
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
const publishedStudyKey = 'glucodel-azt1d-september-2026-diary'
type PublishedDiary = {version: number; meals: Meal[]; revisions: State['revisions']}
type PublishedStudy = {
  period: NonNullable<Workspace['replayPeriod']>; featuredMealId: string;
  meals: Meal[]; boluses: Insulin[]; readings: [at: number, value: number | null][];
}

function withPublishedDiary(workspace: Workspace): Workspace {
  const baseMeals = workspace.state.meals.filter(meal => meal.loggedCarbs !== undefined)
  try {
    const saved = localStorage.getItem(publishedStudyKey)
    if (saved === null) return {...workspace, version: 0, state: {...workspace.state, meals: baseMeals, revisions: {}}}
    const diary = JSON.parse(saved) as PublishedDiary
    const ids = new Set(baseMeals.map(meal => meal.id))
    const meals = diary.meals.map(validateMeal)
    for (const meal of meals) {
      if (ids.has(meal.id)) throw new Error('Повторяющийся идентификатор записи.')
      ids.add(meal.id)
    }
    return {...workspace, version: diary.version, state: {...workspace.state, meals: [...baseMeals, ...meals], revisions: diary.revisions}}
  } catch {
    throw new StorageError('Не удалось прочитать записи из хранилища браузера.')
  }
}

async function readPublishedStudy(): Promise<Workspace> {
  const response = await fetch(new URL('./data/azt1d-september-2026.json', document.baseURI))
  if (!response.ok) throw new Error('Выборка AZT1D недоступна.')
  const snapshot = await response.json() as PublishedStudy
  const workspace = newWorkspace('study')
  return withPublishedDiary({
    ...workspace, replayPeriod: snapshot.period, featuredMealId: snapshot.featuredMealId,
    state: {...workspace.state, meals: snapshot.meals},
    observations: {
      points: insertCgmGaps(snapshot.readings.map(([at, value]) => ({id: 'azt-cgm-' + at, at, value, received: null, source: studyCgmSource}))),
      insulin: snapshot.boluses, context: [],
    },
  })
}

export async function readWorkspace(dataset: Dataset): Promise<Workspace> {
  if (!hasServer && dataset === 'study') return readPublishedStudy()
  if (!hasServer) return newWorkspace('demo', readState())
  const response = await fetch(endpoint(dataset))
  if (!response.ok) throw new Error('Локальный сервер недоступен.')
  return (await response.json() as Result).workspace
}

export async function writeWorkspace(current: Workspace, action: Action | Upload): Promise<Result> {
  if (!hasServer) {
    if (action.type === 'import') throw new Error('Импорт требует локального сервера.')
    if (current.dataset === 'study') {
      const latest = withPublishedDiary(current)
      if (latest.version !== current.version) throw new StorageError('Дневник изменён в другой вкладке. Проверьте записи и повторите действие.', latest)
      const updated = applyAction(latest, action)
      if (updated === latest) return {workspace: latest}
      const diary: PublishedDiary = {version: latest.version + 1,
        meals: updated.state.meals.filter(meal => meal.loggedCarbs === undefined), revisions: updated.state.revisions}
      try {
        localStorage.setItem(publishedStudyKey, JSON.stringify(diary))
      } catch {
        throw new StorageError('Браузер не смог сохранить запись.')
      }
      return {workspace: {...updated, version: diary.version}}
    }
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
