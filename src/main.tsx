import {StrictMode, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Activity, ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, Clock3, FileText, GitCompareArrows, Radio} from 'lucide-react'
import {Analysis, Compare} from './Analysis'
import {MealForm} from './Diary'
import {Report} from './Report'
import {Sources} from './Sources'
import {AddButton, MealRows, makePeriod, PeriodPicker, periodBounds, validPeriod} from './ui'
import {defaultMeal, atLocal, initialState, readState, storageKey, localInput, scenarioMeals, measurements, within, scenarioLabels, type State, type Meal} from './model'
import '@fontsource-variable/inter'
import './styles.css'

const navigation = [
  {key: 'analysis', name: 'Разбор', icon: ChartNoAxesCombined},
  {key: 'diary', name: 'Дневник', icon: BookOpen},
  {key: 'history', name: 'История', icon: Clock3},
  {key: 'compare', name: 'Сравнение', icon: GitCompareArrows},
  {key: 'report', name: 'Отчёт', icon: FileText},
] as const
const getHash = () => window.location.hash.slice(1) || '/analysis/lunch-16'
const url = (path: string) => '#/' + path
const go = (path: string) => {window.location.hash = url(path)}

function App() {
  const [rawRoute, setRawRoute] = useState(getHash)
  const [state, setState] = useState(readState)
  const stateRef = useRef(state)
  const [toast, setToast] = useState('')
  const [systemError, setSystemError] = useState('')
  const [historyPeriod, changeHistoryPeriod] = useState(() => makePeriod(7))
  const [reportPeriod, changeReportPeriod] = useState(() => makePeriod(1))
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(rawRoute)
  const [pathname, search] = rawRoute.split('?')
  const [, page, id, secondId] = pathname.split('/')
  const meals = useMemo(() => scenarioMeals(state).slice().sort((a, b) => b.at - a.at), [state])
  const points = useMemo(() => measurements(state.scenario), [state.scenario])
  const meal = meals.find(item => item.id === id) ?? meals.find(item => item.id === defaultMeal.id) ?? meals[0]
  const left = meals.find(item => item.id === id) ?? meals.find(item => item.id === defaultMeal.id) ?? meals[0]
  const right = meals.find(item => item.id === secondId && item.id !== left.id) ??
    meals.find(item => item.id !== left.id && item.title === left.title) ?? meals.find(item => item.id !== left.id) ?? left
  const formMeal = meals.find(item => item.id === id)
  const anchor = localInput(meals[0].at).slice(0, 10)
  const print = page === 'print'
  const query = new URLSearchParams(search)
  const printPeriod = {from: query.get('from') ?? reportPeriod.from, to: query.get('to') ?? reportPeriod.to, preset: 0}
  const active = print ? 'report' : navigation.some(item => item.key === page) || page === 'sources' ? page : 'analysis'

  useEffect(() => {
    const handler = () => setRawRoute(getHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (previousRoute.current !== rawRoute) {
      const previousPage = previousRoute.current.split('/')[1]
      if (previousPage !== page || page !== 'compare') {
        window.scrollTo(0, 0)
        main.current?.focus({preventScroll: true})
      }
      previousRoute.current = rawRoute
    }
  }, [rawRoute, page])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3800)
    return () => window.clearTimeout(timer)
  }, [toast])
  function persist(next: State) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    stateRef.current = next
    setState(next)
  }
  const updateSettings = (patch: Partial<State>) => {
    try {
      persist({...stateRef.current, ...patch})
      setSystemError('')
      return true
    } catch {
      setSystemError('Не удалось сохранить настройки демо.')
      return false
    }
  }
  const open = (mealId: string) => go('analysis/' + mealId)
  const edit = (mealId: string) => go('diary/' + mealId)
  const add = () => go('diary/new')
  const save = (entry: Meal) => {
    const prior = meals.find(item => item.id === entry.id)
    const revisions = {...state.revisions}
    if (prior && JSON.stringify(prior) === JSON.stringify(entry)) {
      open(entry.id)
      return
    }
    if (prior) {
      revisions[entry.id] = [{meal: prior, savedAt: Date.now()}, ...(revisions[entry.id] ?? [])]
    }
    const nextMeals = prior ? state.meals.map(item => item.id === entry.id ? entry : item) : [...state.meals, entry]
    persist({...state, meals: nextMeals, revisions})
    changeHistoryPeriod(makePeriod(7, localInput(entry.at).slice(0, 10)))
    open(entry.id)
    setToast('Запись сохранена')
  }
  const reset = () => {
    try {
      persist(initialState())
      changeHistoryPeriod(makePeriod(7))
      changeReportPeriod(makePeriod(1))
      open(defaultMeal.id)
      setToast('Исходные данные восстановлены')
      setSystemError('')
    } catch {
      setSystemError('Не удалось сбросить данные демо.')
    }
  }
  const historyBounds = periodBounds(historyPeriod)
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => {event.preventDefault(); main.current?.focus()}}>К содержимому</a>
    <aside className="sidebar screen-only">
      <a href={url('analysis')} className="brand"><span className="brand-mark"><Activity size={22}/></span><span><strong>После еды</strong><small>Журнал наблюдений</small></span></a>
      <nav aria-label="Основная навигация">{navigation.map(item => <a key={item.key} href={url(item.key)} aria-current={item.key === active ? 'page' : undefined}>
        <item.icon size={19}/><span>{item.name}</span>
      </a>)}</nav>
      <div className="sidebar-footer"><a href={url('sources')} aria-current={active === 'sources' ? 'page' : undefined}><Radio size={18}/><span>Источники данных</span><ArrowUpRight size={13}/></a></div>
    </aside>
    <div className="workspace">
      <header className="topbar screen-only">
        <a href={url('analysis')} className="brand mobile-brand"><span className="brand-mark"><Activity size={20}/></span><strong>После еды</strong></a>
        <span className="topbar-label">Журнал наблюдений</span>
        <span className="demo-badge"><i/>Демо · синтетические данные</span>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className={'content ' + (print ? 'print-route' : '')}>
        {systemError && <p role="alert" className="field-error">{systemError}</p>}
        {active === 'analysis' && <Analysis key={meal.id} meal={meal} meals={meals} allPoints={points} scenario={state.scenario}
          sources={() => go('sources')} edit={() => edit(meal.id)} compare={() => go('compare/' + meal.id)} open={open}/>}
        {active === 'diary' && (id === 'new' || formMeal ? <MealForm key={id} latest={atLocal(anchor + 'T18:00')} meal={formMeal}
          versions={formMeal ? state.revisions[formMeal.id] ?? [] : []} onSave={save} onCancel={() => go('diary')}/>
          : <><div className="page-intro section-heading"><div><h1>Дневник питания</h1><p>Приёмы пищи, порции и состав продуктов.</p></div><AddButton onClick={add}/></div>
            <section className="panel list-panel"><MealRows meals={meals} open={open} edit={edit}/></section></>)}
        {active === 'history' && <>
          <div className="page-intro section-heading"><div><h1>История</h1><p>Откройте приём пищи, чтобы посмотреть глюкозу и события после еды.</p></div><AddButton onClick={add}/></div>
          <PeriodPicker value={historyPeriod} change={changeHistoryPeriod} anchor={anchor}/>
          {validPeriod(historyPeriod) && <section className="panel list-panel"><MealRows meals={within(meals, historyBounds.start, historyBounds.end).reverse()} open={open}/></section>}
        </>}
        {active === 'compare' && <Compare meals={meals} measurements={points} left={left} right={right} choose={(a, b) => go('compare/' + a + '/' + b)}/>}
        {active === 'report' && <Report period={print ? printPeriod : reportPeriod} change={changeReportPeriod} meals={meals} points={points} scenario={state.scenario}
          print={print} goPrint={() => go('print?from=' + reportPeriod.from + '&to=' + reportPeriod.to)} goBack={() => {
            changeReportPeriod(printPeriod)
            go('report')
          }} anchor={anchor}/>}
        {active === 'sources' && <Sources state={state} scenario={scenario => {
          if (updateSettings({scenario})) setToast(scenarioLabels[scenario])
        }} connection={connection => updateSettings({connection})} reset={reset}/>}
        <footer className="page-footer screen-only"><span>Все даты и время указаны по Москве</span><a href={url('sources')}><Radio size={15}/>Источники данных</a></footer>
      </main>
    </div>
    <div className="toast-region screen-only" role="status">{toast && <div className="toast"><Check size={18}/>{toast}</div>}</div>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
