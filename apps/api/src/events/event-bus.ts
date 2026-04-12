import { EventEmitter } from "node:events";
import { type DomainEventMap, type DomainEventName } from "./domain-events";

// ─── Typed Event Bus ─────────────────────────────────────────────────────────
// Wraps Node.js EventEmitter with type-safe emit/on methods.
// Listeners execute asynchronously (fire-and-forget) with error isolation —
// a failing listener never blocks the HTTP response or crashes other listeners.

type Listener<K extends DomainEventName> = (payload: DomainEventMap[K]) => void | Promise<void>;

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Raise the limit — we may have multiple listeners per event
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit a domain event. All registered listeners are invoked asynchronously.
   * Errors in listeners are caught and logged — they never propagate to the caller.
   */
  emit<K extends DomainEventName>(event: K, payload: DomainEventMap[K]): void {
    // Schedule listeners async so they don't block the calling service method
    setImmediate(() => {
      const listeners = this.emitter.listeners(event) as Listener<K>[];
      for (const listener of listeners) {
        try {
          const result = listener(payload);
          // If listener returns a promise, catch its errors
          if (result && typeof result === "object" && "catch" in result) {
            (result as Promise<void>).catch((err: unknown) => {
              process.stderr.write(
                JSON.stringify({
                  level: "error",
                  msg: "[EventBus] Async listener error",
                  event,
                  err: err instanceof Error ? err.message : String(err),
                }) + "\n",
              );
            });
          }
        } catch (err) {
          process.stderr.write(
            JSON.stringify({
              level: "error",
              msg: "[EventBus] Sync listener error",
              event,
              err: err instanceof Error ? err.message : String(err),
            }) + "\n",
          );
        }
      }
    });
  }

  /**
   * Register a listener for a domain event.
   */
  on<K extends DomainEventName>(event: K, listener: Listener<K>): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove a specific listener.
   */
  off<K extends DomainEventName>(event: K, listener: Listener<K>): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove all listeners (useful in tests).
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

export const eventBus = new EventBus();
