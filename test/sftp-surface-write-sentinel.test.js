// dsh-remote#1：写类方法成功必须 resolve(true)，不能是 undefined。
//
// 背景：ssh2 的写回调是 cb(err)，没有第二个参数，所以以前成功时 resolve 到
// undefined。dsh-deck-remote-exec 的 fs 代理用 `r !== null && r !== undefined`
// 判定成功，于是每一次成功的远端写入都被误报成 returned-null
// （RDE_REMOTE_WRITE_FAILED），文件其实已经写进去了。
//
// 契约归 dsh-remote 定义（能力出口），上层只透传。这里锁住三件事：
//   1. 写方法成功 → true；
//   2. 写方法失败 → 仍然 reject（不能把失败吞成 true）；
//   3. 读方法返回值原样（不受影响）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSftpSurface } from '../lib/sftp-surface.js'

/** 假 sftp 通道：写回调只给 err（与 ssh2 真实行为一致）。 */
function fakeChannel(overrides = {}) {
  const ok = (cb) => setImmediate(() => cb(null))
  return {
    readdir: (d, cb) => cb(null, [{ filename: 'a' }, { filename: 'b' }]),
    stat: (p, cb) => cb(null, { size: 3, mode: 0o644 }),
    lstat: (p, cb) => cb(null, { size: 3, mode: 0o644 }),
    readFile: (p, cb) => cb(null, Buffer.from('hi')),
    realpath: (p, cb) => cb(null, p),
    mkdir: (d, cb) => ok(cb),
    rmdir: (d, cb) => ok(cb),
    unlink: (p, cb) => ok(cb),
    rename: (a, b, cb) => ok(cb),
    setstat: (p, a, cb) => ok(cb),
    writeFile: (p, data, cb) => ok(cb),
    // createFileExclusive 走 sftp.open('wx') → sftp.write(handle, bytes, 0, len, 0, cb)
    // → sftp.close(handle, cb)；fake 按这个真实签名应答。
    open: (p, flags, opts, cb) => cb(null, { handle: true }),
    write: (handle, bytes, off, len, pos, wcb) => wcb(null),
    close: (handle, ccb) => ccb(null),
    on() {},
    ...overrides,
  }
}

const surface = (ch) => buildSftpSurface(ch, { commandTimeoutMs: 5000 })

test('写方法成功一律返回 true（不是 undefined）', async () => {
  const s = surface(fakeChannel())
  assert.equal(await s.mkdir('/x'), true)
  assert.equal(await s.rmdir('/x'), true)
  assert.equal(await s.unlink('/x'), true)
  assert.equal(await s.rename('/a', '/b'), true)
  assert.equal(await s.renameOverwrite('/a', '/b'), true)
  assert.equal(await s.setstat('/x', { mode: 0o644 }), true)
  assert.equal(await s.writeFile('/x', Buffer.from('data')), true)
  assert.equal(await s.createFileExclusive('/x', Buffer.from('once')), true)
})

test('写方法失败仍然 reject —— 哨兵不能把失败吞成 true', async () => {
  const failing = (msg) => (cb) => setImmediate(() => cb(Object.assign(new Error(msg), { code: 'FAIL' })))
  const s = surface(fakeChannel({
    mkdir: (d, cb) => failing('mkdir no')(cb),
    writeFile: (p, data, cb) => failing('write no')(cb),
  }))
  await assert.rejects(() => s.mkdir('/x'), /mkdir no/)
  await assert.rejects(() => s.writeFile('/x', Buffer.from('d')), /write no/)
})

test('读方法返回值原样，不受哨兵影响', async () => {
  const s = surface(fakeChannel())
  assert.deepEqual((await s.readdir('/d')).map((e) => e.filename), ['a', 'b'])
  assert.equal((await s.stat('/p')).size, 3)
  assert.equal(String(await s.readFile('/p')), 'hi')
})
