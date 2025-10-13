import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { Server as SocketIOServer } from 'socket.io'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  // Socket.ioサーバーを初期化
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: `http://localhost:${port}`,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  })

  // グローバルにio instanceを保存（API routesからアクセスできるように）
  global.io = io

  // Socket.io接続管理
  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`)

    // 会話ルームに参加
    socket.on('join-conversation', (conversationId: string) => {
      socket.join(`conversation-${conversationId}`)
      console.log(`[WebSocket] ${socket.id} joined conversation-${conversationId}`)
    })

    // 会話ルームから退出
    socket.on('leave-conversation', (conversationId: string) => {
      socket.leave(`conversation-${conversationId}`)
      console.log(`[WebSocket] ${socket.id} left conversation-${conversationId}`)
    })

    // 切断時
    socket.on('disconnect', () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`)
    })
  })

  // サーバー起動
  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server is running`)
  })
})

// TypeScript型定義を追加
declare global {
  var io: SocketIOServer | undefined
}
