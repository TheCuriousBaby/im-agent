// 设置窗口中的各个简单页面：模型、引擎与输入、本机 API、远程任务源、运行日志、模型用量与关于。
import { formatClock, formatCost } from '../format'
import { useEngineEvents, useUsage } from '../hooks'
import { ModelForm, NumberField } from '../components/fields'
import { SaveBar, useSettingsContext } from './SettingsContext'

export function ModelsSection(): React.JSX.Element {
  const { draft, patch, secrets, setSecret, saveAndTest, busy, results } = useSettingsContext()

  const toggleSeparate = (role: 'reply' | 'profile', on: boolean): void => {
    if (on) patch({ [role]: { ...draft.vision, apiKeySet: false } })
    else patch({ [role]: null })
  }

  return (
    <div className="section">
      <p className="muted">
        识别模型必须支持图片输入。回复与画像未单独配置时沿用识别模型。截图和对话内容只会发送到你在这里填写的端点。
      </p>
      <ModelForm
        title="识别模型（看截图）"
        value={draft.vision}
        secret={secrets.vision}
        result={results.vision}
        busy={busy}
        onChange={(v) => patch({ vision: v })}
        onSecret={(s) => setSecret('vision', s)}
        onTest={() => void saveAndTest('vision')}
      />
      {(['reply', 'profile'] as const).map((role) => {
        const value = draft[role]
        return (
          <div key={role}>
            <label className="check">
              <input type="checkbox" checked={value !== null} onChange={(e) => toggleSeparate(role, e.target.checked)} />
              <span>为“{role === 'reply' ? '回复' : '画像'}”使用单独的模型</span>
            </label>
            {value && (
              <ModelForm
                title={role === 'reply' ? '回复模型（生成回复）' : '画像模型（抽取联系人信息）'}
                value={value}
                secret={secrets[role]}
                result={results[role]}
                busy={busy}
                onChange={(v) => patch({ [role]: v })}
                onSecret={(s) => setSecret(role, s)}
                onTest={() => void saveAndTest(role)}
              />
            )}
          </div>
        )
      })}
      <SaveBar />
    </div>
  )
}

export function EngineSection(): React.JSX.Element {
  const { draft, patch } = useSettingsContext()
  return (
    <div className="section">
      <div className="card">
        <h3>回复与切换</h3>
        <div className="grid">
          <label className="field">
            <span>回复方式</span>
            <select
              value={draft.engine.replyMode}
              onChange={(e) => patch({ engine: { ...draft.engine, replyMode: e.target.value as 'auto' | 'confirm' } })}
            >
              <option value="confirm">生成后由我确认再发送</option>
              <option value="auto">自动发送</option>
            </select>
          </label>
          <label className="field">
            <span>切换未读会话的方式</span>
            <select
              value={draft.engine.unreadSwitch}
              onChange={(e) => patch({ engine: { ...draft.engine, unreadSwitch: e.target.value as 'hotkey' | 'click' } })}
            >
              <option value="click">点击未读红点</option>
              <option value="hotkey">快捷键 Ctrl+G（仅微信）</option>
            </select>
          </label>
          <NumberField
            label="轮询间隔（毫秒）"
            value={draft.engine.pollIntervalMs}
            onChange={(n) => patch({ engine: { ...draft.engine, pollIntervalMs: n } })}
          />
          <NumberField
            label="回复后轮询间隔（毫秒）"
            value={draft.engine.afterReplyPollMs}
            onChange={(n) => patch({ engine: { ...draft.engine, afterReplyPollMs: n } })}
          />
          <NumberField
            label="界面变化灵敏度（变化像素占比，越小越灵敏）"
            step={0.001}
            value={draft.engine.changeRatio}
            onChange={(n) => patch({ engine: { ...draft.engine, changeRatio: n } })}
          />
          <NumberField
            label="无变化时的兜底识别间隔（毫秒，0 为关闭）"
            value={draft.engine.idleRefreshMs}
            onChange={(n) => patch({ engine: { ...draft.engine, idleRefreshMs: n } })}
          />
          <NumberField
            label="回复时参考的最近消息条数"
            value={draft.engine.contextMessages}
            onChange={(n) => patch({ engine: { ...draft.engine, contextMessages: n } })}
          />
        </div>
      </div>

      <div className="card">
        <h3>键鼠输入</h3>
        <div className="grid">
          <label className="field">
            <span>发送键</span>
            <select
              value={draft.input.sendKeys}
              onChange={(e) => patch({ input: { ...draft.input, sendKeys: e.target.value as 'enter' | 'ctrl-enter' | 'compat' } })}
            >
              <option value="enter">Enter</option>
              <option value="ctrl-enter">Ctrl+Enter</option>
              <option value="compat">兼容序列（Enter 后补 Ctrl+Enter）</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.input.humanize}
              onChange={(e) => patch({ input: { ...draft.input, humanize: e.target.checked } })}
            />
            <span>鼠标轨迹与操作间隔加入随机变化</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3>联系人画像</h3>
        <p className="muted">画像只保存在本机。启用后，对话内容会发送到画像模型用于抽取联系人信息。</p>
        <div className="grid">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.profileMemory.enabled}
              onChange={(e) => patch({ profileMemory: { ...draft.profileMemory, enabled: e.target.checked } })}
            />
            <span>启用联系人画像</span>
          </label>
          <NumberField
            label="每累计多少条新消息抽取一次"
            value={draft.profileMemory.extractEveryNMessages}
            onChange={(n) => patch({ profileMemory: { ...draft.profileMemory, extractEveryNMessages: n } })}
          />
          <NumberField
            label="注入提示词的画像字数上限"
            value={draft.profileMemory.injectMaxChars}
            onChange={(n) => patch({ profileMemory: { ...draft.profileMemory, injectMaxChars: n } })}
          />
        </div>
      </div>
      <SaveBar />
    </div>
  )
}

export function ApiSection(): React.JSX.Element {
  const { draft, patch } = useSettingsContext()
  return (
    <div className="section">
      <div className="card">
        <p className="muted">仅监听 127.0.0.1，请求需携带 Authorization: Bearer 令牌，可用于入队任务和控制启停。</p>
        <div className="grid">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.localApi.enabled}
              onChange={(e) => patch({ localApi: { ...draft.localApi, enabled: e.target.checked } })}
            />
            <span>启用本机 API</span>
          </label>
          <NumberField
            label="端口"
            value={draft.localApi.port}
            onChange={(n) => patch({ localApi: { ...draft.localApi, port: n } })}
          />
          <label className="field wide">
            <span>令牌</span>
            <input readOnly value={draft.localApi.token} />
          </label>
        </div>
        <p className="muted">接口：GET /status、POST /pause、POST /resume、POST /stop、POST /tasks。</p>
      </div>
      <SaveBar />
    </div>
  )
}

export function RemoteSection(): React.JSX.Element {
  const { draft, patch, secrets, setSecret } = useSettingsContext()
  return (
    <div className="section">
      <div className="card">
        <p className="muted">连接到你自己的服务以接收任务并回传结果，默认关闭。协议见源码 wsTaskSource.ts。</p>
        <div className="grid">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.remote.enabled}
              onChange={(e) => patch({ remote: { ...draft.remote, enabled: e.target.checked } })}
            />
            <span>启用远程任务源</span>
          </label>
          <label className="field wide">
            <span>WebSocket 地址（ws:// 或 wss://）</span>
            <input value={draft.remote.wsUrl} onChange={(e) => patch({ remote: { ...draft.remote, wsUrl: e.target.value } })} />
          </label>
          <label className="field wide">
            <span>令牌{draft.remote.tokenSet ? '（已设置，留空保持不变）' : ''}</span>
            <input
              type="password"
              autoComplete="off"
              value={secrets.remote}
              onChange={(e) => setSecret('remote', e.target.value)}
            />
          </label>
        </div>
      </div>
      <SaveBar />
    </div>
  )
}

export function LogSection(): React.JSX.Element {
  const events = useEngineEvents(300)
  return (
    <div className="section">
      <div className="card">
        <div className="log">
          {events.length === 0 && <span className="muted">暂无日志</span>}
          {[...events].reverse().map((e, i) => (
            <div key={`${e.ts}-${i}`} className={`log-line ${e.level}`}>
              <span className="time">{formatClock(e.ts)}</span>
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function UsageSection(): React.JSX.Element {
  const usage = useUsage()
  return (
    <div className="section">
      <div className="card">
        <div className="row spread">
          <h3>本次运行的模型用量</h3>
          <button onClick={() => void window.imAgent.usage.reset()}>清零</button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>角色</th>
              <th>调用次数</th>
              <th>输入 token</th>
              <th>输出 token</th>
              <th>估算成本</th>
            </tr>
          </thead>
          <tbody>
            {usage &&
              (['vision', 'reply', 'profile'] as const).map((role) => (
                <tr key={role}>
                  <td>{{ vision: '识别', reply: '回复', profile: '画像' }[role]}</td>
                  <td>{usage.byRole[role].calls}</td>
                  <td>{usage.byRole[role].inputTokens}</td>
                  <td>{usage.byRole[role].outputTokens}</td>
                  <td>{formatCost(usage.byRole[role].costUsd)}</td>
                </tr>
              ))}
            {usage && (
              <tr className="total">
                <td>合计</td>
                <td>{usage.total.calls}</td>
                <td>{usage.total.inputTokens}</td>
                <td>{usage.total.outputTokens}</td>
                <td>{formatCost(usage.total.costUsd)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted">成本按“模型”页里填写的单价估算，token 数以接口返回为准。</p>
      </div>
    </div>
  )
}

export function AboutSection(): React.JSX.Element {
  return (
    <div className="section">
      <div className="card">
        <h3>IM Agent</h3>
        <p>本地运行的 IM 窗口自动化助手：截取目标聊天窗口，交给你配置的视觉模型识别，由回复模型生成回复，再用键鼠发送。</p>
        <p className="muted">
          没有账号体系，也没有云端依赖。设置、联系人画像、定时任务和日志都保存在本机，模型密钥经系统凭据加密。
          截图只会发往你在“模型”页配置的端点。
        </p>
        <p className="muted">快捷键：Ctrl+Alt+S 选择目标窗口，Ctrl+Alt+P 暂停或恢复。</p>
      </div>
    </div>
  )
}
