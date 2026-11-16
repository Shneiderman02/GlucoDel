import {StrictMode, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Activity, ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, Clock3, FileText, GitCompareArrows, Radio} from 'lucide-react'
import {Analysis, Compare} from './Analysis'
import {MealForm} from './Diary'
import {Report} from './Report'
import {Sources} from './Sources'
import {Archive} from './Archive'
import {hasServer, readWorkspace, StorageError, writeWorkspace, type Upload} from './storage'
import {workspaceDay, type Action, type Workspace} from './workspace'
import {AddButton, MealRows, makePeriod, PeriodPicker, periodBounds, validPeriod, Empty} from './ui'
import {defaultMeal, atLocal, localInput, scenarioMeals, within, scenarioLabels, type Meal} from './model'
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

function App({initial}: {initial: Workspace}) {
  const [rawRoute, setRawRoute] = useState(getHash)
  const [workspace, setWorkspace] = useState(initial)
  const stateRef = useRef(workspace)
  const {state, observations} = workspace
  const isArchive = workspace.dataset === 'archive'
  const anchor = workspaceDay(workspace)
  const [toast, setToast] = useState('')
  const [systemError, setSystemError] = useState('')
  const [historyPeriod, changeHistoryPeriod] = useState(() => makePeriod(7, workspaceDay(initial)))
  const [reportPeriod, changeReportPeriod] = useState(() => makePeriod(1, workspaceDay(initial)))
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(rawRoute)
  const [pathname, search] = rawRoute.split('?')
  const [, page, id, secondId] = pathname.split('/')
  const meals = useMemo(() => scenarioMeals(state).slice().sort((a, b) => b.at - a.at), [state])
  const meal = meals.find(item => item.id === id) ?? meals.find(item => item.id === defaultMeal.id) ?? meals[0]
  const left = meals.find(item => item.id === id) ?? meals.find(item => item.id === defaultMeal.id) ?? meals[0]
  const right = meals.find(item => item.id === secondId && item.id !== left?.id) ??
    meals.find(item => item.id !== left.id && item.title === left?.title) ?? meals.find(item => item.id !== left.id) ?? left
  const formMeal = meals.find(item => item.id === id)
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
  const receive = (next: Workspace) => {
    stateRef.current = next
    setWorkspace(next)
  }
  const mutate = async (action: Action | Upload) => {
    try {
      const result = await writeWorkspace(stateRef.current, action)
      receive(result.workspace)
      setSystemError('')
      return result
    } catch (error) {
      if (error instanceof StorageError && error.workspace) receive(error.workspace)
      throw error
    }
  }
  const updateSettings = async (action: Action) => {
    try {
      await mutate(action)
      return true
    } catch {
      setSystemError('Не удалось сохранить настройки демо. Повторите действие.')
      return false
    }
  }
  const open = (mealId: string) => go('analysis/' + mealId)
  const edit = (mealId: string) => go('diary/' + mealId)
  const add = () => go('diary/new')
  const save = async (entry: Meal) => {
    await mutate({type: 'meal', meal: entry})
    changeHistoryPeriod(makePeriod(7, localInput(entry.at).slice(0, 10)))
    open(entry.id)
    setToast('Запись сохранена')
  }
  const reset = async () => {
    try {
      await mutate({type: 'reset'})
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
      <a href={url('analysis')} className="brand"><span className="brand-mark"><Activity size={22}/></span><span><strong>GlucoDel</strong><small>Глюкоза после еды</small></span></a>
      <nav aria-label="Основная навигация">{navigation.map(item => <a key={item.key} href={url(item.key)} aria-current={item.key === active ? 'page' : undefined}>
        <item.icon size={19}/><span>{item.name}</span>
      </a>)}</nav>
      <div className="sidebar-footer"><a href={url('sources')} aria-current={active === 'sources' ? 'page' : undefined}><Radio size={18}/><span>Источники данных</span><ArrowUpRight size={13}/></a></div>
    </aside>
    <div className="workspace">
      <header className="topbar screen-only">
        <a href={url('analysis')} className="brand mobile-brand"><span className="brand-mark"><Activity size={20}/></span><strong>GlucoDel</strong></a>
        <span className="topbar-label">Разбор глюкозы при СД1</span>
        <span className="demo-badge"><i/>{isArchive ? 'Локальный архив' : 'Демо · синтетические данные'}</span>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className={'content ' + (print ? 'print-route' : '')}>
        {systemError && <p role="alert" className="field-error">{systemError}</p>}
        {active === 'analysis' && (meal ? <Analysis key={meal.id} meal={meal} meals={meals} observations={observations} scenario={state.scenario}
          sources={() => go('sources')} edit={() => edit(meal.id)} compare={() => go('compare/' + meal.id)} open={open}/>
          : <><div className="page-intro section-heading"><div><h1>Глюкоза после еды</h1><p>Запишите приём пищи, чтобы сопоставить его с данными архива.</p></div><AddButton onClick={add}/></div>
            <section className="panel"><Empty>В локальном архиве пока нет приёмов пищи.</Empty></section></>)}
        {active === 'diary' && (id === 'new' || formMeal ? <MealForm key={id} latest={atLocal(anchor + 'T18:00')} meal={formMeal}
          versions={formMeal ? state.revisions[formMeal.id] ?? [] : []} onSave={save} onCancel={() => go('diary')}/>
          : <><div className="page-intro section-heading"><div><h1>Дневник питания</h1><p>Приёмы пищи, порции и состав продуктов.</p></div><AddButton onClick={add}/></div>
            <section className="panel list-panel"><MealRows meals={meals} open={open} edit={edit}/></section></>)}
        {active === 'history' && <>
          <div className="page-intro section-heading"><div><h1>История</h1><p>Откройте приём пищи, чтобы посмотреть глюкозу и события после еды.</p></div><AddButton onClick={add}/></div>
          <PeriodPicker value={historyPeriod} change={changeHistoryPeriod} anchor={anchor}/>
          {validPeriod(historyPeriod) && <section className="panel list-panel"><MealRows meals={within(meals, historyBounds.start, historyBounds.end).reverse()} open={open}/></section>}
        </>}
        {active === 'compare' && (left && right && left !== right
          ? <Compare meals={meals} observations={observations} left={left} right={right} choose={(a, b) => go('compare/' + a + '/' + b)}/>
          : <><div className="page-intro section-heading"><h1>Сравнение эпизодов</h1><AddButton onClick={add}/></div>
            <section className="panel"><Empty>Добавьте два приёма пищи, чтобы сравнить их на одной шкале.</Empty></section></>)}
        {active === 'report' && <Report period={print ? printPeriod : reportPeriod} change={changeReportPeriod} meals={meals} observations={observations} scenario={state.scenario} isArchive={isArchive}
          print={print} goPrint={() => go('print?from=' + reportPeriod.from + '&to=' + reportPeriod.to)} goBack={() => {
            changeReportPeriod(printPeriod)
            go('report')
          }} anchor={anchor}/>}
        {active === 'sources' && (isArchive
          ? <Archive observations={observations} upload={async action => {
            const result = await mutate(action)
            changeHistoryPeriod(makePeriod(7, workspaceDay(result.workspace)))
            changeReportPeriod(makePeriod(1, workspaceDay(result.workspace)))
            return result.imported!
          }} add={add}/>
          : <Sources state={state} scenario={async scenario => {
            if (await updateSettings({type: 'scenario', scenario})) setToast(scenarioLabels[scenario])
          }} connection={connection => updateSettings({type: 'connection', connection})} reset={reset} local={hasServer}/>)}
        <footer className="page-footer screen-only"><span>Все даты и время указаны по Москве</span><a href={url('sources')}><Radio size={15}/>Источники данных</a></footer>
      </main>
    </div>
    <div className="toast-region screen-only" role="status">{toast && <div className="toast"><Check size={18}/>{toast}</div>}</div>
  </div>
}

const root = createRoot(document.getElementById('root')!)
const dataset = hasServer && new URLSearchParams(window.location.search).get('workspace') === 'archive' ? 'archive' : 'demo'
async function start() {
  if (hasServer) root.render(<main className="content" role="status">Открываем локальный архив…</main>)
  try {
    const workspace = await readWorkspace(dataset)
    root.render(<StrictMode><App initial={workspace}/></StrictMode>)
  } catch {
    root.render(<main className="content"><h1>Локальный архив недоступен</h1><p>Запустите сервер и повторите попытку.</p>
      <button className="button primary" onClick={start}>Повторить</button></main>)
  }
}
void start()
