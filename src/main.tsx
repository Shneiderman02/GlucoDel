import {StrictMode, useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Activity, ArrowUpRight, BookOpen, ChartNoAxesCombined, Check, Clock3, FileText, GitCompareArrows, Radio} from 'lucide-react'
import {Analysis, Compare} from './Analysis'
import {GlucoseChart} from './Chart'
import {MealForm} from './Diary'
import {Report} from './Report'
import {Sources} from './Sources'
import {Archive} from './Archive'
import {hasServer, readWorkspace, StorageError, syncNightscout, writeWorkspace, type Upload} from './storage'
import {workspaceDay, type Action, type Workspace} from './workspace'
import {AddButton, MealRows, makePeriod, PeriodPicker, periodBounds, validPeriod, Empty, type Period} from './ui'
import {defaultMeal, atLocal, date, localInput, scenarioMeals, within, scenarioLabels, studyBadge, studyTime, studyLimit, type Meal} from './model'
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
  const isStudy = workspace.dataset === 'study'
  const replay = workspace.replayPeriod
  const canWrite = !isStudy || !!replay
  const hasNightscout = isArchive && !!workspace.nightscout?.configured
  const anchor = workspaceDay(workspace)
  const [toast, setToast] = useState('')
  const [systemError, setSystemError] = useState('')
  const [historyPeriod, changeHistoryPeriod] = useState<Period>(() => initial.replayPeriod
    ? {...initial.replayPeriod, preset: 0} : makePeriod(7, workspaceDay(initial)))
  const [reportPeriod, changeReportPeriod] = useState(() => makePeriod(1, workspaceDay(initial)))
  const [historyDay, setHistoryDay] = useState('')
  const main = useRef<HTMLElement>(null)
  const previousRoute = useRef(rawRoute)
  const [pathname, search] = rawRoute.split('?')
  const [, page, id, secondId] = pathname.split('/')
  const meals = useMemo(() => scenarioMeals(state).slice().sort((a, b) => b.at - a.at), [state])
  const meal = meals.find(item => item.id === id) ?? meals.find(item => item.id === (workspace.featuredMealId ?? defaultMeal.id)) ?? meals[0]
  const left = meal
  const right = meals.find(item => item.id === secondId && item.id !== left?.id) ??
    meals.find(item => item.id !== left?.id && item.title === left?.title) ?? meals.find(item => item.id !== left?.id) ?? left
  const formMeal = meals.find(item => item.id === id)
  const editable = (item?: Meal) => canWrite && item?.loggedCarbs === undefined
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
  useEffect(() => {
    if (!hasNightscout) return
    let active = true
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const prior = stateRef.current
      try {
        const next = await readWorkspace('archive')
        if (active && prior === stateRef.current && next.version >= prior.version) {
          stateRef.current = next
          setWorkspace(next)
        }
      } catch {
        // Keep the local view while the server is unavailable.
      }
    }, 15_000)
    return () => {active = false; window.clearInterval(timer)}
  }, [hasNightscout])
  const receive = (next: Workspace) => {
    if (next.version < stateRef.current.version) return
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
    if (!replay) changeHistoryPeriod(makePeriod(7, localInput(entry.at).slice(0, 10)))
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
  const replayDays = useMemo(() => {
    if (!replay) return []
    const {start, end} = periodBounds({ ...replay, preset: 0 })
    const days = []
    for (let at = start; at <= end; at += 86_400_000) {
      const iso = localInput(at).slice(0, 10)
      if (iso >= historyPeriod.from && iso <= historyPeriod.to) days.push({iso, at})
    }
    return days
  }, [replay, historyPeriod.from, historyPeriod.to])
  const day = replayDays.find(item => item.iso === historyDay) ?? (replayDays.length === 1 ? replayDays[0] : undefined)
  const dailyPoints = useMemo(() => day ? within(observations.points, day.at, day.at + 86_400_000 - 1) : [], [day, observations.points])
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
        <span className="demo-badge"><i/>{replay ? 'AZT1D · даты сдвинуты' : isStudy ? studyBadge : isArchive ? 'Локальный архив' : 'Демо · синтетические данные'}</span>
      </header>
      <main id="main-content" ref={main} tabIndex={-1} className={'content ' + (print ? 'print-route' : '')}>
        {systemError && <p role="alert" className="field-error">{systemError}</p>}
        {active === 'analysis' && (meal ? <Analysis key={meal.id} meal={meal} meals={meals} observations={observations} scenario={state.scenario}
          sources={() => go('sources')} edit={editable(meal) ? () => edit(meal.id) : undefined} compare={() => go('compare/' + meal.id)} open={open} replay={!!replay}/>
          : <><div className="page-intro section-heading"><div><h1>Глюкоза после еды</h1><p>Запишите приём пищи, чтобы сопоставить его с данными архива.</p></div><AddButton onClick={add}/></div>
            <section className="panel"><Empty>В локальном архиве пока нет приёмов пищи.</Empty></section></>)}
        {active === 'diary' && (editable(formMeal) && (id === 'new' || formMeal) ? <MealForm key={id} latest={atLocal((replay ? day?.iso ?? replay.to : anchor) + 'T18:00')} meal={formMeal} replayPeriod={replay}
          versions={formMeal ? state.revisions[formMeal.id] ?? [] : []} onSave={save} onCancel={() => go('diary')}/>
          : <><div className="page-intro section-heading"><div><h1>{isStudy && !replay ? 'Записи об углеводах' : 'Дневник питания'}</h1><p>{replay ? 'Записи помпы и добавленные вручную приёмы пищи.' : isStudy ? studyLimit : 'Приёмы пищи, порции и состав продуктов.'}</p></div>{canWrite && <AddButton onClick={add}/>}</div>
            <section className="panel list-panel"><MealRows meals={meals} open={open} edit={canWrite ? edit : undefined}/></section></>)}
        {active === 'history' && <>
          <div className="page-intro section-heading"><div><h1>История</h1><p>{replay ? 'Данные за 1 сентября — 1 октября 2026 года · даты сдвинуты' : isStudy ? 'Откройте запись об углеводах, чтобы посмотреть показания CGM и болюсы.' : 'Откройте приём пищи, чтобы посмотреть глюкозу и события после еды.'}</p></div>{canWrite && <AddButton onClick={add}/>}</div>
          <PeriodPicker value={historyPeriod} change={period => {changeHistoryPeriod(period); setHistoryDay('')}} anchor={anchor}
            fullPeriod={replay}/>
          {replayDays.length > 0 && <div className="period-tools date-inputs"><label>График за день <select value={day?.iso ?? ''} onChange={event => setHistoryDay(event.target.value)}>
            <option value="">Весь выбранный период</option>
            {replayDays.map(item => <option key={item.iso} value={item.iso}>{date(item.at)}</option>)}
          </select></label></div>}
          {day && <section className="panel plot-panel"><div className="panel-header"><h2>Глюкоза · {date(day.at)}</h2></div>
            <GlucoseChart key={day.iso} hours={24} series={[{name: 'Измерения CGM', start: day.at, points: dailyPoints}]}/></section>}
          {validPeriod(historyPeriod) && <section className="panel list-panel"><MealRows meals={within(meals,
            day?.at ?? historyBounds.start, day ? day.at + 86_400_000 - 1 : historyBounds.end).reverse()} open={open}/></section>}
        </>}
        {active === 'compare' && (left && right && left !== right
          ? <Compare meals={meals} observations={observations} left={left} right={right} choose={(a, b) => go('compare/' + a + '/' + b)} replay={!!replay}/>
          : <><div className="page-intro section-heading"><h1>Сравнение эпизодов</h1><AddButton onClick={add}/></div>
            <section className="panel"><Empty>Добавьте два приёма пищи, чтобы сравнить их на одной шкале.</Empty></section></>)}
        {active === 'report' && <Report period={print ? printPeriod : reportPeriod} change={changeReportPeriod} meals={meals} observations={observations} scenario={state.scenario} isArchive={isArchive} isStudy={isStudy} replay={replay}
          print={print} goPrint={() => go('print?from=' + reportPeriod.from + '&to=' + reportPeriod.to)} goBack={() => {
            changeReportPeriod(printPeriod)
            go('report')
          }} anchor={anchor}/>}
        {active === 'sources' && (isStudy
          ? <><div className="page-intro"><h1>Источники данных</h1><p>Открытое исследование AZT1D · версия 1</p></div>
            <section className="panel source-panel"><h2>Показания CGM и журнал помпы</h2>
              <p>Dexcom G6 Pro и Tandem t:slim X2. {replay
                ? 'Записи с 1 февраля по 2 марта 2024 года перенесены на 1 сентября — 1 октября 2026 года. Время суток и интервалы сохранены.'
                : '1–3 февраля 2024 года. ' + studyTime + '.'}</p>
              <p>{studyLimit} Почасовой базал и физическая активность в этой выборке не показаны.</p>
              <p><a href="https://data.mendeley.com/datasets/gk9m674wcx/1">Открыть AZT1D · Mendeley Data · CC BY 4.0</a></p>
              <div className="row-actions"><a className="button secondary" href="?workspace=archive#/sources">Личный архив</a>
                <a className="button quiet" href="./#/sources">Синтетическое демо</a></div>
            </section></>
          : isArchive
          ? <Archive observations={observations} nightscout={workspace.nightscout} sync={async () => {
            try {
              receive(await syncNightscout())
            } catch (error) {
              if (error instanceof StorageError && error.workspace) receive(error.workspace)
              throw error
            }
          }} upload={async action => {
            const result = await mutate(action)
            changeHistoryPeriod(makePeriod(7, workspaceDay(result.workspace)))
            changeReportPeriod(makePeriod(1, workspaceDay(result.workspace)))
            return result.imported!
          }} add={add}/>
          : <Sources state={state} scenario={async scenario => {
            if (await updateSettings({type: 'scenario', scenario})) setToast(scenarioLabels[scenario])
          }} connection={connection => updateSettings({type: 'connection', connection})} reset={reset} local={hasServer}/>)}
        <footer className="page-footer screen-only"><span>{replay ? 'Даты сдвинуты · время суток сохранено' : isStudy ? studyTime : 'Все даты и время указаны по Москве'}</span><a href={url('sources')}><Radio size={15}/>Источники данных</a></footer>
      </main>
    </div>
    <div className="toast-region screen-only" role="status">{toast && <div className="toast"><Check size={18}/>{toast}</div>}</div>
  </div>
}

const root = createRoot(document.getElementById('root')!)
const requested = new URLSearchParams(window.location.search).get('workspace')
const dataset = hasServer && (requested === 'archive' || requested === 'study') ? requested : 'demo'
async function start() {
  if (hasServer) root.render(<main className="content" role="status">Открываем локальный архив…</main>)
  try {
    const workspace = await readWorkspace(dataset)
    root.render(<StrictMode><App initial={workspace}/></StrictMode>)
  } catch {
    root.render(<main className="content"><h1>{dataset === 'study' ? 'Выборка AZT1D недоступна' : 'Локальный архив недоступен'}</h1>
      {dataset === 'study' ? <p>Выполните <code>python server/prepare-azt1d.py</code> и перезапустите локальный сервер. <a href="./">Открыть синтетическое демо</a></p> : <p>Запустите сервер и повторите попытку.</p>}
      <button className="button primary" onClick={start}>Повторить</button></main>)
  }
}
void start()
