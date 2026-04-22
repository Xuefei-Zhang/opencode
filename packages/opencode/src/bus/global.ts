import { EventEmitter } from "events"

type Events = {
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}

const bus = new EventEmitter()

export const GlobalBus = {
  on<K extends keyof Events>(type: K, handler: (...args: Events[K]) => void) {
    bus.on(type, handler)
  },
  off<K extends keyof Events>(type: K, handler: (...args: Events[K]) => void) {
    bus.off(type, handler)
  },
  emit<K extends keyof Events>(type: K, ...args: Events[K]) {
    bus.emit(type, ...args)
  },
}
