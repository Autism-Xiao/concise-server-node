/**
 * S3 存储驱动 SigV4 协议测试（node:test，跑 dist 里编译后的实现）。
 * 前置：先 `npm run build`。运行：`npm test`
 *
 * 思路：起一个本地 HTTP 服务端扮演 S3 兼容对象存储，按 AWS Signature V4 规范
 * **独立重算**请求签名并比对 Authorization 头（服务端校验逻辑与驱动端实现互相独立，
 * 签名错/头漏/路径错/Range 处理错都会真实暴露，不依赖外部凭证）。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const http = require('node:http')

process.env.FILE_STORAGE_S3_ENDPOINT = 'http://127.0.0.1:0' // 占位，真正端口由 server.address() 决定
process.env.FILE_STORAGE_S3_REGION = 'us-east-1'
process.env.FILE_STORAGE_S3_BUCKET = 'test-bucket'
process.env.FILE_STORAGE_S3_ACCESS_KEY = 'AKIDEXAMPLE'
process.env.FILE_STORAGE_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
process.env.FILE_STORAGE_S3_PATH_STYLE = 'true'

/** 服务端独立实现：按 SigV4 重算签名（规范顺序：method、canonicalPath、query、headers、signedHeaders、payloadHash） */
function expectedAuth({ method, path, query, headers, body }) {
  const secret = process.env.FILE_STORAGE_S3_SECRET_KEY
  const amzDate = headers['x-amz-date']
  const payloadHash = crypto.createHash('sha256').update(body || '').digest('hex')
  const canonicalPath = path // path-style：/test-bucket/<key>，测试 key 无特殊字符
  const signedHeaderNames = Object.keys(headers).map(h => h.toLowerCase()).sort()
  const canonicalHeaders = signedHeaderNames.map(h => `${h}:${String(headers[h]).trim()}\n`).join('')
  const canonicalRequest = [method, canonicalPath, query || '', canonicalHeaders, signedHeaderNames.join(';'), payloadHash].join('\n')
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${process.env.FILE_STORAGE_S3_REGION}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), process.env.FILE_STORAGE_S3_REGION), 's3'), 'aws4_request')
  return `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')}`
}

test('S3 驱动四操作均带合法 SigV4 签名（服务端独立重算校验）', async () => {
  const seen = []
  const store = new Map() // key → body

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = { ...req.headers }
    // 只用驱动声明参与签名的头（SignedHeaders）重算 —— 其余头（user-agent 等）不进签名
    const declared = /SignedHeaders=([^,]+)/.exec(headers.authorization ?? '')?.[1] ?? ''
    const signed = {}
    for (const name of declared.split(';')) signed[name] = headers[name]
    if (headers.authorization !== expectedAuth({ method: req.method, path: req.url.split('?')[0], query: req.url.split('?')[1] ?? '', headers: signed, body })) {
        res.writeHead(403, { 'content-type': 'application/xml' })
        res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>')
        seen.push('BAD-SIG')
        return
      }
      const key = req.url.replace(/^\/test-bucket\//, '')
      seen.push(req.method)
      if (req.method === 'PUT') {
        store.set(key, body)
        res.writeHead(200)
        res.end()
        return
      }
      if (req.method === 'HEAD') {
        res.writeHead(store.has(key) ? 200 : 404)
        res.end()
        return
      }
      if (req.method === 'GET') {
        const range = req.headers.range
        if (range) {
          // bytes=0-5 → 前 6 字节
          const m = /^bytes=(\d+)-(\d*)$/.exec(range)
          const start = Number(m[1])
          const end = m[2] ? Math.min(Number(m[2]), store.get(key).length - 1) : undefined
          const slice = store.get(key).subarray(start, end === undefined ? undefined : end + 1)
          res.writeHead(206, { 'content-range': `bytes ${start}-${start + slice.length - 1}/${store.get(key).length}` })
          res.end(slice)
          return
        }
        res.writeHead(200)
        res.end(store.get(key))
        return
      }
      if (req.method === 'DELETE') {
        store.delete(key)
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(400)
      res.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.FILE_STORAGE_S3_ENDPOINT = `http://127.0.0.1:${server.address().port}`

  // 工厂已缓存单例/或驱动构造时读 env —— 直接 new 驱动类（dist）
  const { S3StorageProvider } = require('../dist/shared/storage/s3-storage.provider.js')
  const provider = new S3StorageProvider('s3')

  try {
    await provider.write('abc/def.bin', Buffer.from('hello s3 world'))
    ok(await provider.exists('abc/def.bin'))
    ok(!(await provider.exists('missing.bin')))
    const head = await provider.readHead('abc/def.bin', 5)
    assert.equal(head.toString(), 'hello')
    const chunks = []
    for await (const chunk of await provider.openStream('abc/def.bin')) chunks.push(chunk)
    assert.equal(Buffer.concat(chunks).toString(), 'hello s3 world')
    await provider.delete('abc/def.bin')
    ok(!(await provider.exists('abc/def.bin')))
  } finally {
    server.close()
  }

  assert.deepEqual(seen, ['PUT', 'HEAD', 'HEAD', 'GET', 'GET', 'DELETE', 'HEAD'])
})

function ok(cond) {
  assert.ok(cond)
}
