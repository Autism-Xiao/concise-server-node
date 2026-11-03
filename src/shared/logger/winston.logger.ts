import path from 'node:path'

import 'winston-daily-rotate-file'
import * as winston from 'winston'

const { combine, timestamp, printf, colorize, errors } = winston.format

const isProd = process.env.NODE_ENV === 'production'

const consoleFormat = combine(
  colorize({ level: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp: ts, context }) => {
    const ctx = typeof context === 'string' ? ` [${context}]` : ''
    return `${String(ts)} ${level}${ctx} ${String(message)}`
  })
)

const fileFormat = combine(errors({ stack: true }), timestamp(), winston.format.json())

/** 按日轮转的文件 transport（logs/ 已在 .gitignore 中） */
const fileTransport = new winston.transports.DailyRotateFile({
  dirname: path.resolve(process.cwd(), 'logs'),
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m',
  level: 'info',
  format: fileFormat
})

export const winstonLogger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  transports: [new winston.transports.Console({ format: consoleFormat }), fileTransport]
})
