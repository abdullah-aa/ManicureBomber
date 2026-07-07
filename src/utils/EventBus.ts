/**
 * Minimal hand-rolled typed event bus. Events is a map interface from event
 * name to payload type (see managers/GameEvents.ts). Emission is synchronous
 * and in subscription order. on() returns an unsubscribe closure.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  public on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => set.delete(handler as (payload: never) => void);
  }

  public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (payload: Events[K]) => void)(payload);
    }
  }
}
