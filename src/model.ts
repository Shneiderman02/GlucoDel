export const demoDay = '2026-11-16'
export const zone = 'Europe/Moscow'
export const minute = 60_000
export const nutrients = ['protein', 'fat', 'carbs', 'energy'] as const
export type Nutrient = typeof nutrients[number]
export const labels = {protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы', energy: 'Энергия'}
export const unit = (key: Nutrient) => key === 'energy' ? 'ккал' : 'г'
export type Product = {id: string; name: string; grams: number} & Record<Nutrient, number | null>
export type Meal = {id: string; title: string; at: number; products: Product[]}
export type Revision = {meal: Meal; savedAt: number}
export type CGM = {id: string; at: number; received: number | null; value: number | null; source: string}
export type Insulin = {id: string; at: number; end?: number; title: string; type: 'basal' | 'bolus'; actual: number | null; planned?: number; reported?: number; status: 'given' | 'interrupted' | 'cancelled' | 'reported'; mode: string; source: string}
export type Context = {id: string; at: number; title: string; description: string; source: string}
export type Scenario = 'full' | 'delay' | 'gap' | 'partial'
export type Connection = 'pending' | 'connected' | 'denied' | 'error'
export const scenarioLabels: Record<Scenario, string> = {full: 'Полный эпизод', delay: 'Задержанные данные', gap: 'Пробел CGM', partial: 'Неполный состав еды'}
export const connectionLabels: Record<Connection, string> = {pending: 'Ожидание', connected: 'Подключено', denied: 'Отказ', error: 'Ошибка'}
export type State = {meals: Meal[]; revisions: Record<string, Revision[]>; scenario: Scenario; connection: Connection}
export const atLocal = (iso: string) => Date.parse(iso + '+03:00')
export const number = (value: number, digits = 2) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: digits}).format(value)
const clockFormat = new Intl.DateTimeFormat('ru-RU', {timeZone: zone, hour: '2-digit', minute: '2-digit'})
const dateFormat = new Intl.DateTimeFormat('ru-RU', {timeZone: zone, day: 'numeric', month: 'long'})
export const time = (value: number) => clockFormat.format(value)
export const date = (value: number) => dateFormat.format(value)
export const localInput = (value: number) => new Date(value + 180 * minute).toISOString().slice(0, 16)
export const within = <T extends {at: number}>(records: T[], start: number, end: number) =>
  records.filter(row => row.at >= start && row.at <= end).sort((a, b) => a.at - b.at)
export const asNumber = (value: string) => value.trim() === '' ? null : Number(value)
export function nutrition(products: Product[]) {
  return {
    grams: products.reduce((sum, product) => sum + product.grams, 0),
    totals: Object.fromEntries(nutrients.map(key => {
      const known = products.filter(product => product[key] !== null)
      const value = known.reduce((sum, product) => sum + (product[key] ?? 0) * product.grams / 100, 0)
      return [key, {value: known.length ? value : null, complete: known.length === products.length && products.length > 0}]
    })) as Record<Nutrient, {value: number | null; complete: boolean}>,
  }
}

const lunch = (id: string, day: string): Meal => ({
  id, title: 'Гречка с курицей', at: atLocal(day + 'T13:00'), products: [
    {id: 'buckwheat', name: 'Гречка отварная', grams: 180, protein: 3.6, fat: 1.1, carbs: 19.9, energy: 110},
    {id: 'chicken', name: 'Куриное филе', grams: 120, protein: 26, fat: 3, carbs: 0, energy: 138},
  ],
})
const initialMeals: Meal[] = [
  lunch('lunch-16', demoDay),
  lunch('lunch-14', '2026-11-14'),
  {id: 'snack-16', title: 'Яблоко', at: atLocal(demoDay + 'T14:45'), products: [
    {id: 'apple', name: 'Яблоко', grams: 130, protein: 0.4, fat: 0.4, carbs: 11.8, energy: 52},
  ]},
  {id: 'breakfast-11', title: 'Овсянка с йогуртом', at: atLocal('2026-11-11T08:30'), products: [
    {id: 'oats', name: 'Овсяная каша', grams: 150, protein: 4, fat: null, carbs: 14, energy: 88},
    {id: 'yogurt', name: 'Йогурт', grams: 90, protein: 5, fat: 2, carbs: 4, energy: 58},
  ]},
]
export const defaultMeal = initialMeals[0]
export const initialState = (): State => ({meals: initialMeals, revisions: {}, scenario: 'full', connection: 'connected'})
export const storageKey = 'posle-edy-demo-v1'
export function readState(): State {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored) as State : initialState()
  } catch {
    return initialState()
  }
}

const pump = 'Демо-помпа'
const sensor = 'Демо-CGM'
const manual = 'Дневник'
const first = defaultMeal.at
const second = initialMeals[1].at
const breakfast = initialMeals[3].at
export const insulin: Insulin[] = [
  {id: 'bolus1', at: first + 5 * minute, title: 'Болюс', type: 'bolus', actual: 3.2, planned: 3.2, status: 'given', mode: 'Ручной', source: pump},
  {id: 'basal1', at: first + 30 * minute, end: first + 60 * minute, title: 'Базал', type: 'basal', actual: 0.45, status: 'given', mode: 'Ручной', source: pump},
  {id: 'cancel1', at: first + 80 * minute, title: 'Коррекция отменена', type: 'bolus', actual: null, planned: 0.6, status: 'cancelled', mode: 'Ручной', source: pump},
  {id: 'auto1', at: first + 155 * minute, title: 'Автокоррекция', type: 'bolus', actual: 0.3, status: 'given', mode: 'Автоматический', source: pump},
  {id: 'bolus2', at: second + 5 * minute, title: 'Продлённый болюс прерван', type: 'bolus', actual: 1.8, planned: 3.4, status: 'interrupted', mode: 'Ручной', source: pump},
  {id: 'basal2', at: second + 25 * minute, end: second + 55 * minute, title: 'Базал', type: 'basal', actual: 0.6, status: 'given', mode: 'Ручной', source: pump},
]
export const context: Context[] = [
  {id: 'walk1', at: first + 60 * minute, title: 'Прогулка', description: '25 мин · умеренный темп', source: manual},
  {id: 'walk2', at: second + 80 * minute, title: 'Прогулка', description: '10 мин · спокойный темп', source: manual},
]
const profiles = [
  {id: 'a', start: first, points: [6.1, 6.15, 6.2, 6.4, 6.75, 7.12, 7.55, 8.02, 8.53, 8.87, 9.14, 9.29, 9.38, 9.52, 9.48, 9.35, 9.08, 8.83, 8.64, 8.4, 8.2, 8.08, 8.15, 8.25, 8.4, 8.48, 8.11, 8.04, 7.9, 7.67, 7.43, 7.2, 7.01, 6.93, 6.91, 6.88, 6.86, 6.93, 7.01, 7.02, 7.11, 7.14, 7.19, 7.2, 7.19, 7.2, 7.2, 7.2, 7.2]},
  {id: 'b', start: second, points: [6.5, 6.58, 6.75, 7.07, 7.46, 7.91, 8.48, 8.9, 9.37, 9.74, 10.2, 10.5, 10.7, null, null, null, null, 10.85, 10.6, 10.4, 10.09, 9.8, 9.55, 9.38, 9.21, 9.1, 8.91, 8.72, 8.63, 8.45, 8.24, 8.09, 7.91, 7.82, 7.71, 7.62, 7.6, 7.58, 7.55, 7.55, 7.51, 7.48, 7.45, 7.39, 7.36, 7.31, 7.27, 7.22, 7.2]},
  {id: 'c', start: breakfast, points: [5.8, 6.1, 6.3, 6.6, 7, 7.3, 7.7, 8, 8.1, 8.3, 8.39, 8.41, 8.49, 8.5, 8.53, 8.6, 8.53, 8.51, 8.49, 8.44, 8.42, 8.39, 8.38, 8.4, 8.4]},
]
export function measurements(scenario: Scenario): CGM[] {
  return profiles.flatMap(({id, start, points}) => points.flatMap((point, index) => {
    if (id === 'a' && scenario === 'delay' && index > 13) return []
    const at = start + index * 5 * minute
    const value = id === 'a' && scenario === 'gap' && index >= 14 && index <= 17 ? null : point
    return [{id: id + index, value, at, received: at + (id === 'a' && scenario === 'delay' ? 45 : 2) * minute, source: sensor}]
  })).sort((a, b) => a.at - b.at)
}

export function scenarioMeals(state: State): Meal[] {
  return state.scenario === 'partial' ? state.meals.map(meal => meal.id === defaultMeal.id && !state.revisions[meal.id]?.length ? {
    ...meal, products: meal.products.map((product, index) => index === 0 ? {...product, fat: null} : product),
  } : meal) : state.meals
}
export function actualTotal(events: Insulin[]): number | null {
  const known = events.filter(item => item.status !== 'cancelled' && item.actual !== null)
  return known.length ? known.reduce((sum, item) => sum + (item.actual ?? 0), 0) : null
}
export function insulinText(event: Insulin) {
  if (event.status === 'reported') return event.reported === undefined ? 'Подача не подтверждена' : number(event.reported) + ' ед. в записи · подача не подтверждена'
  if (event.status === 'cancelled') return event.planned === undefined ? 'Отменено' : 'Отменено · план ' + number(event.planned) + ' ед.'
  if (event.actual === null) return 'Фактическая подача неизвестна'
  const actual = number(event.actual) + ' ед. фактически'
  return event.status === 'interrupted' && event.planned !== undefined ? actual + ' из ' + number(event.planned) + ' ед.' : actual
}

export function gapRanges(points: CGM[]) {
  const groups: {start: number; end: number}[] = []
  let open = false
  for (const point of points) {
    if (point.value === null) {
      if (!open) groups.push({start: point.at, end: point.at})
      else groups[groups.length - 1].end = point.at
      open = true
    } else open = false
  }
  return groups
}

export const forecastReason = (scenario: Scenario, points: CGM[], meal?: Meal) => {
  if (!points.some(point => point.value !== null)) return 'В выбранном окне нет измерений CGM.'
  if (scenario === 'delay' && points.some(point => point.received !== null && point.received - point.at > 5 * minute)) return 'Измерения CGM получены с задержкой 45 мин.'
  if (gapRanges(points).length) return 'В выбранном окне есть пробел измерений CGM.'
  if (meal?.products.some(product => nutrients.some(key => product[key] === null))) return 'Состав еды указан не полностью.'
  return 'Историческая выгрузка не обновляется в реальном времени.'
}

export type TimelineEvent = {id: string; at: number; end?: number; title: string; category: 'meal' | 'insulin' | 'activity'; marker: string; source: string; description: string; mealId?: string}
export function timeline(meals: Meal[], start: number, end: number, doses: Insulin[], activities: Context[]): TimelineEvent[] {
  return within<TimelineEvent>([
    ...meals.map(meal => ({
      id: meal.id, at: meal.at, title: meal.title, category: 'meal' as const, marker: 'meal', source: manual,
      description: number(nutrition(meal.products).grams) + ' г · ' + meal.products.map(product => product.name).join(', '), mealId: meal.id,
    })),
    ...doses.map(event => ({
      id: event.id, at: event.at, end: event.end, title: event.title, category: 'insulin' as const,
      marker: event.status === 'cancelled' ? 'cancel' : event.status === 'reported' ? 'reported' : event.type, source: event.source,
      description: insulinText(event) + ' · режим: ' + event.mode.toLowerCase(),
    })),
    ...activities.map(event => ({...event, category: 'activity' as const, marker: 'activity'})),
  ], start, end)
}
