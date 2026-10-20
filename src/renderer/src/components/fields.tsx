// 设置页通用表单控件：数字输入与模型配置表单。
import type { PublicModelConfig } from '../../../shared/settings'
import type { TestResult } from '../../../shared/types'

export function NumberField(props: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step}
        value={Number.isFinite(props.value) ? props.value : 0}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function ModelForm(props: {
  title: string
  value: PublicModelConfig
  secret: string
  result?: TestResult
  busy: boolean
  onChange: (value: PublicModelConfig) => void
  onSecret: (value: string) => void
  onTest: () => void
}): React.JSX.Element {
  const { value, onChange } = props
  return (
    <div className="subcard">
      <div className="row spread">
        <h3>{props.title}</h3>
        <button disabled={props.busy} onClick={props.onTest}>
          保存并测试
        </button>
      </div>
      {props.result && (
        <p className={props.result.ok ? 'ok' : 'error'}>
          {props.result.message}
          {props.result.latencyMs !== undefined && `（${props.result.latencyMs} 毫秒）`}
        </p>
      )}
      <div className="grid">
        <label className="field wide">
          <span>端点地址（OpenAI 兼容，含 /v1；单独配置的回复、画像模型留空则沿用上一级）</span>
          <input value={value.baseUrl} onChange={(e) => onChange({ ...value, baseUrl: e.target.value })} />
        </label>
        <label className="field wide">
          <span>密钥{value.apiKeySet ? '（已设置，留空保持不变）' : '（单独配置的回复、画像模型留空则沿用上一级）'}</span>
          <input
            type="password"
            autoComplete="off"
            value={props.secret}
            onChange={(e) => props.onSecret(e.target.value)}
          />
        </label>
        <label className="field">
          <span>模型名称</span>
          <input value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} />
        </label>
        <label className="field">
          <span>接口协议</span>
          <select value={value.wire} onChange={(e) => onChange({ ...value, wire: e.target.value as 'chat' | 'responses' })}>
            <option value="chat">chat（chat/completions）</option>
            <option value="responses">responses</option>
          </select>
        </label>
        <label className="field">
          <span>推理强度</span>
          <select
            value={value.reasoningEffort}
            onChange={(e) => onChange({ ...value, reasoningEffort: e.target.value as PublicModelConfig['reasoningEffort'] })}
          >
            <option value="">不指定</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <NumberField label="超时（毫秒）" value={value.timeoutMs} onChange={(n) => onChange({ ...value, timeoutMs: n })} />
        <NumberField
          label="截图最长边（像素）"
          value={value.maxImageSide}
          onChange={(n) => onChange({ ...value, maxImageSide: n })}
        />
        <NumberField
          label="最大输出 token（含思考）"
          value={value.maxOutputTokens}
          onChange={(n) => onChange({ ...value, maxOutputTokens: n })}
        />
        <NumberField
          label="输入单价（美元 / 百万 token）"
          step={0.01}
          value={value.priceInPerM}
          onChange={(n) => onChange({ ...value, priceInPerM: n })}
        />
        <NumberField
          label="输出单价（美元 / 百万 token）"
          step={0.01}
          value={value.priceOutPerM}
          onChange={(n) => onChange({ ...value, priceOutPerM: n })}
        />
        <label className="field wide">
          <span>额外请求参数（JSON 对象，会合并进请求体；百炼关闭思考可填 {'{"enable_thinking": false}'}）</span>
          <input value={value.extraBody} onChange={(e) => onChange({ ...value, extraBody: e.target.value })} />
        </label>
        {/dashscope/i.test(value.baseUrl) && value.extraBody.trim() === '' && (
          <div className="field wide">
            <span className="muted">
              百炼的 Qwen3 系列可能默认开启思考，识图场景下一次调用会慢到一分钟以上，建议关闭思考。
            </span>
            <div className="row">
              <button onClick={() => onChange({ ...value, extraBody: '{"enable_thinking": false}' })}>关闭思考</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
