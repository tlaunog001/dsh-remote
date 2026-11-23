// dsh-remote#2：SFTP 连接失败必须带结构化 code。
//
// 上层（dsh-deck-remote-exec）要能在日志里区分「SFTP 没连上」和「连上了但写
// 失败」。message 是给人看的，code 是给机器判的。契约只增不改：失败仍然
// reject（不改成返回 null），只是多一个 code 字段。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../lib/openssh.js', import.meta.url)), 'utf8')

test('五条失败路径各自带稳定的结构化错误码', () => {
  const expected = {
    SFTP_TIMEOUT: '超时：握手/建链没在预算内完成',
    SFTP_HANDSHAKE_FAILED: '握手失败：sftp 通道 error 事件',
    SFTP_SPAWN_FAILED: '起子进程失败：ssh 可执行文件/参数问题',
    SFTP_CHANNEL_CLOSED: '通道非零退出：远端 sftp-server 退出',
    SFTP_TARGET_CHANGED: '目标切换：握手期间机器被换掉',
  }
  for (const code of Object.keys(expected)) {
    assert.ok(SRC.includes(`'${code}'`), `缺少错误码 ${code}（${expected[code]}）`)
  }
})

test('失败语义未变：仍然是 reject，没有改成返回 null 或吞异常', () => {
  // 这些位置都必须仍在 done(...) / throw 路径里，而不是 resolve(null)。
  assert.ok(!/done\(null\)\s*;?\s*\/\/\s*timeout/.test(SRC), '超时不能改成 resolve(null)')
  for (const code of ['SFTP_TIMEOUT', 'SFTP_HANDSHAKE_FAILED', 'SFTP_SPAWN_FAILED', 'SFTP_CHANNEL_CLOSED']) {
    const near = SRC.slice(Math.max(0, SRC.indexOf(`'${code}'`) - 200), SRC.indexOf(`'${code}'`) + 40)
    assert.ok(/done\(coded\(/.test(near), `${code} 必须走 done(coded(...)) 的 reject 路径`)
  }
})

test('错误码只增不改：sftp() 成功路径仍 resolve 一个 surface', () => {
  assert.ok(/resolve\(\{\s*child,\s*sftp\s*\}\)/.test(SRC), '成功路径必须仍 resolve({ child, sftp })')
})
