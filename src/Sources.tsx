import {useEffect, useRef, useState} from 'react'
import {Database, RotateCcw, Radio, LoaderCircle} from 'lucide-react'
import {type Connection, type Scenario, type State, scenarioLabels, connectionLabels} from './model'
import {Notice} from './ui'

export function Sources({state, scenario, connection, reset, local}: {
  state: State; scenario: (next: Scenario) => Promise<void>; connection: (next: Connection) => Promise<boolean>; reset: () => Promise<void>; local: boolean;
}) {
  const [target, setTarget] = useState<Exclude<Connection, 'pending'>>('connected')
  const [running, setRunning] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const simulate = async (result: Exclude<Connection, 'pending'>) => {
    setRunning(true)
    if (!await connection('pending')) {
      setRunning(false)
      return
    }
    timer.current = window.setTimeout(async () => {
      await connection(result)
      setRunning(false)
    }, 800)
  }
  return <>
    <div className="page-intro"><h1>Источники данных</h1><p>Переключайте демонстрационные сценарии и проверяйте состояние данных.</p></div>
    {local && <p className="archive-link row-actions"><a className="button secondary" href="?workspace=study#/history"><Database size={16}/>Открыть выборку AZT1D</a>
      <a className="button secondary" href="?workspace=archive#/sources"><Database size={16}/>Открыть локальный архив</a></p>}
    <div className="source-grid">
      <section className="panel source-panel"><span className="row-icon"><Database size={19}/></span><h2>Историческая выгрузка</h2><p>Демо-CGM и демо-помпа · время по Москве</p>
        <Notice>Историческая выгрузка не обновляется в реальном времени.</Notice>
        <fieldset className="scenarios"><legend>Набор данных</legend>
          {Object.entries(scenarioLabels).map(([key, title]) => <label key={key}>
            <input type="radio" name="scenario" value={key} checked={key === state.scenario} onChange={() => scenario(key as Scenario)}/><span>{title}</span>
          </label>)}
        </fieldset>
      </section>
      <section className="panel source-panel"><span className="row-icon"><Radio size={19}/></span><h2>Подключение · симуляция</h2><p>В демонстрации можно воспроизвести состояния источника.</p>
        <p className="connection-state" role="status">{running && <LoaderCircle size={17} className="spinner"/>}{connectionLabels[state.connection]} · Демо-CGM</p>
        {state.connection === 'denied' && <p>Доступ к тестовому источнику отклонён. Можно запустить повторную попытку.</p>}
        {state.connection === 'error' && <p>Тестовый источник не ответил. Повторите попытку.</p>}
        {state.connection === 'pending' && !running && <p>Предыдущая попытка не завершена. Запустите её снова.</p>}
        <label>Результат следующей попытки
          <select value={target} disabled={running} onChange={event => setTarget(event.target.value as typeof target)}>
            <option value="connected">Подключено</option><option value="denied">Отказ</option><option value="error">Ошибка</option>
          </select>
        </label>
        <div className="form-actions">
          <button className="button primary" disabled={running} onClick={() => simulate(target)}>Проверить подключение</button>
          {state.connection !== 'connected' && !running && <button className="button secondary" onClick={() => {setTarget('connected'); simulate('connected')}}>Повторить попытку</button>}
        </div>
      </section>
    </div>
    <section className="reset">
      {confirmReset ? <div><p>Восстановить исходные сценарии и удалить локальные записи и их версии?</p><div className="form-actions">
        <button className="button danger" onClick={reset}>Сбросить данные и изменения</button>
        <button className="button quiet" onClick={() => setConfirmReset(false)}>Отмена</button>
      </div></div> : <button className="button quiet" onClick={() => setConfirmReset(true)}><RotateCcw size={16}/>Сбросить демо</button>}
    </section>
  </>
}
