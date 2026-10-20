// jsonExtract 的单元测试：从各种模型输出形态中取出 JSON。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeOutput, extractJson } from './jsonExtract'

test('直接的 JSON 对象', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
})

test('代码块围栏', () => {
  assert.deepEqual(extractJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] })
})

test('前后带说明文字', () => {
  assert.deepEqual(extractJson('好的，结果如下：{"action":"skip"} 以上。'), { action: 'skip' })
})

test('字符串里的括号不影响配对', () => {
  assert.deepEqual(extractJson('{"text":"a } b { c","n":2}'), { text: 'a } b { c', n: 2 })
})

test('转义引号', () => {
  assert.deepEqual(extractJson('{"t":"他说\\"好\\"}"}'), { t: '他说"好"}' })
})

test('顶层数组', () => {
  assert.deepEqual(extractJson('结果：[{"x":1},{"x":2}]'), [{ x: 1 }, { x: 2 }])
})

test('没有 JSON 或 JSON 损坏时抛出', () => {
  assert.throws(() => extractJson('没有任何结构'), /没有找到 JSON/)
  assert.throws(() => extractJson('{"a":'), /没有找到 JSON/)
  assert.throws(() => extractJson('{a:1}'), /无法解析/)
})

test('输出开头片段合并空白并限制长度，保留字母 s', () => {
  assert.equal(describeOutput('  hello \n  stars '), '；模型输出开头：hello stars')
  assert.equal(describeOutput(''), '；模型输出为空')
  assert.equal(describeOutput('a'.repeat(500), 10), `；模型输出开头：${'a'.repeat(10)}`)
})

test('漏了逗号的数组元素与对象属性会被修复', () => {
  assert.deepEqual(extractJson('[{"a":1}\n{"b":2}]'), [{ a: 1 }, { b: 2 }])
  assert.deepEqual(extractJson('["x" "y"]'), ['x', 'y'])
  assert.deepEqual(extractJson('{"a": 1\n "b": [1 2]}'), { a: 1, b: [1, 2] })
  assert.deepEqual(extractJson('{"ok": true\n"n": null}'), { ok: true, n: null })
})

test('闭合括号前多余的逗号会被去掉', () => {
  assert.deepEqual(extractJson('{"a":[1,2,],}'), { a: [1, 2] })
  assert.deepEqual(extractJson('[{"x":1,\n},\n]'), [{ x: 1 }])
})

test('修复不影响字符串内容与合法 JSON', () => {
  assert.deepEqual(extractJson('{"t":"a,] b\\" {c} 1 2"}'), { t: 'a,] b" {c} 1 2' })
  assert.deepEqual(extractJson('{"a":[1,-2.5e3,true,false,null],"b":{"c":"d"}}'), {
    a: [1, -2500, true, false, null],
    b: { c: 'd' }
  })
})

test('被截断的 JSON 不会被悄悄补全，仍然报错', () => {
  assert.throws(() => extractJson('{"messages":[{"text":"a"},{"text":"b'), /没有找到 JSON/)
})

test('无法修复时错误信息带出错位置附近的原文', () => {
  assert.throws(() => extractJson('{"a": 1, "b": 2 x}'), /出错位置附近/)
})

test('漏写内层闭合符会被补上（数组直接写成了 } 结尾）', () => {
  const text = '{"messages":[{"role":"self","text":"a","box":[458,108,608,150 },{"role":"peer","text":"b","box":null}]}'
  assert.deepEqual(extractJson(text), {
    messages: [
      { role: 'self', text: 'a', box: [458, 108, 608, 150] },
      { role: 'peer', text: 'b', box: null }
    ]
  })
  assert.deepEqual(extractJson('{"a":[1,2}'), { a: [1, 2] })
})

test('补闭合符时一并处理前面多余的逗号，字符串里的括号不参与配对', () => {
  assert.deepEqual(extractJson('{"a":[1,2, }'), { a: [1, 2] })
  assert.deepEqual(extractJson('{"t":"]}[","b":[1 }'), { t: ']}[', b: [1] })
})
