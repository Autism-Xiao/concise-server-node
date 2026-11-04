import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from './../src/app.module'

describe('AppController (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  it('/ (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200)
    // 统一响应为标准 Result：{ code, message, result, success, timestamp }
    expect(res.body).toMatchObject({ code: 0, message: '', result: 'Hello World!', success: true })
    expect(typeof res.body.timestamp).toBe('number')
  })

  afterEach(async () => {
    await app.close()
  })
})
