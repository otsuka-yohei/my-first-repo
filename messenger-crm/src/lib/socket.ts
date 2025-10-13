import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * Socket.ioクライアントのシングルトンインスタンスを取得
 */
export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000'

    socket = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      console.log('[Socket] Connected to WebSocket server')
    })

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from WebSocket server')
    })

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error)
    })
  }

  return socket
}

/**
 * Socket接続を切断
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
    console.log('[Socket] Socket disconnected and cleared')
  }
}
