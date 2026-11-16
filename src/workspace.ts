import {type Meal, type State, type Scenario, type Connection, type CGM, type Insulin, type Context,
  initialState, insulin, context, measurements, scenarioMeals, localInput, nutrients} from './model.ts'

export type Dataset = 'demo' | 'archive'
export type Observations = {points: CGM[]; insulin: Insulin[]; context: Context[]}
export type Workspace = {dataset: Dataset; version: number; state: State; observations: Observations}
export type Action =
  | {type: 'meal'; meal: Meal}
  | {type: 'scenario'; scenario: Scenario}
  | {type: 'connection'; connection: Connection}
  | {type: 'reset'}
export const demoObservations = (scenario: Scenario) => ({points: measurements(scenario), insulin, context})
export const newWorkspace = (dataset: Dataset, state = initialState()): Workspace => dataset === 'demo'
  ? {dataset, version: 0, state, observations: demoObservations(state.scenario)}
  : {dataset, version: 0, state: {...initialState(), meals: []}, observations: {points: [], insulin: [], context: []}}

export function applyAction(workspace: Workspace, action: Action): Workspace {
  const {state} = workspace
  if (action.type === 'reset') {
    if (workspace.dataset !== 'demo') throw new Error('Сброс доступен только для демо.')
    return {...newWorkspace('demo'), version: workspace.version}
  }
  if (action.type === 'scenario') {
    if (workspace.dataset !== 'demo' || !['full', 'delay', 'gap', 'partial'].includes(action.scenario)) throw new Error('Неизвестный сценарий.')
    return {...workspace, state: {...state, scenario: action.scenario}, observations: demoObservations(action.scenario)}
  }
  if (action.type === 'connection') {
    if (workspace.dataset !== 'demo' || !['pending', 'connected', 'denied', 'error'].includes(action.connection)) throw new Error('Неизвестное состояние подключения.')
    return {...workspace, state: {...state, connection: action.connection}}
  }
  if (action.type !== 'meal') throw new Error('Неизвестное действие.')
  const meal = validateMeal(action.meal)
  const prior = scenarioMeals(state).find(item => item.id === meal.id)
  if (prior && JSON.stringify(prior) === JSON.stringify(meal)) return workspace
  const revisions = prior ? {...state.revisions, [meal.id]: [{meal: prior, savedAt: Date.now()}, ...(state.revisions[meal.id] ?? [])]} : state.revisions
  const meals = prior ? state.meals.map(item => item.id === meal.id ? meal : item) : [...state.meals, meal]
  return {...workspace, state: {...state, meals, revisions}}
}

const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
export function validateMeal(meal: Meal): Meal {
  if (!meal || !validId(meal.id) || !validText(meal.title) ||
      !Number.isSafeInteger(meal.at) || meal.at < Date.UTC(1900, 0) || meal.at >= Date.UTC(2100, 0) ||
      !Array.isArray(meal.products) || !meal.products.length || meal.products.length > 100) {
    throw new Error('Проверьте название, дату и продукты приёма пищи.')
  }
  const ids = new Set<string>()
  const products = meal.products.map(product => {
    if (!product || !validId(product.id) || ids.has(product.id) || !validText(product.name) ||
        !Number.isFinite(product.grams) || product.grams <= 0 ||
        nutrients.some(key => product[key] !== null && (!Number.isFinite(product[key]) || product[key]! < 0 ||
          !Number.isFinite(product[key]! * product.grams)))) {
      throw new Error('Проверьте массу и пищевую ценность продуктов.')
    }
    ids.add(product.id)
    return {id: product.id, name: product.name.trim(), grams: product.grams, protein: product.protein, fat: product.fat, carbs: product.carbs, energy: product.energy}
  })
  return {id: meal.id, title: meal.title.trim(), at: meal.at, products}
}

export function workspaceDay(workspace: Workspace) {
  const timestamps = [
    ...workspace.state.meals.map(meal => meal.at),
    workspace.observations.points.at(-1)?.at ?? 0,
    workspace.observations.insulin.at(-1)?.at ?? 0,
  ]
  const latest = Math.max(...timestamps)
  return localInput(latest || Date.now()).slice(0, 10)
}
