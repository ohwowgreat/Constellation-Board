// An isolated Realtime Database test double. No request reaches real Firebase.
(() => {
  const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
  let data = JSON.parse(localStorage.getItem('test-firebase') || 'null') || window.__firebaseSeed || {};
  const listeners = [], reads = [];
  window.__firebaseReads = reads;
  const get = path => path === '.info/connected' ? true : path.split('/').filter(Boolean).reduce((value, key) => value?.[key], data) ?? null;
  const materialize = value => {
    if (value && value['.sv'] === 'timestamp') return Date.now();
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]));
    return value;
  };
  const set = (path, value) => {
    const parts = path.split('/').filter(Boolean), key = parts.pop();
    if (!key) { data = materialize(clone(value)) || {}; return; }
    let parent = data;
    parts.forEach(part => { parent = parent[part] ||= {}; });
    if (value === null) delete parent[key]; else parent[key] = materialize(clone(value));
  };
  class Snapshot {
    constructor(path, value = get(path)) { this.key = path.split('/').pop(); this.value = clone(value); }
    val() { return clone(this.value); }
    exists() { return this.value !== null; }
    numChildren() { return Object.keys(this.value || {}).length; }
    forEach(callback) { for (const [key, value] of Object.entries(this.value || {})) if (callback(new Snapshot(key, value)) === true) break; }
  }
  function deliver(listener, initial = false) {
    if (!listeners.includes(listener)) return;
    const now = clone(get(listener.path)), before = listener.previous;
    listener.previous = now;
    if (listener.event === 'value') {
      if (initial || JSON.stringify(now) !== JSON.stringify(before)) listener.callback(new Snapshot(listener.path, now));
      return;
    }
    const previousChildren = before || {}, children = now || {};
    if (listener.event === 'child_removed') {
      for (const [key, value] of Object.entries(previousChildren)) if (!(key in children)) listener.callback(new Snapshot(key, value));
    } else {
      for (const [key, value] of Object.entries(children)) {
        if (listener.event === 'child_added' && !(key in previousChildren)) listener.callback(new Snapshot(key, value));
        if (listener.event === 'child_changed' && key in previousChildren && JSON.stringify(value) !== JSON.stringify(previousChildren[key])) listener.callback(new Snapshot(key, value));
      }
    }
  }
  function flush() {
    localStorage.setItem('test-firebase', JSON.stringify(data));
    queueMicrotask(() => listeners.slice().forEach(listener => deliver(listener)));
  }
  class Ref {
    constructor(path) { this.path = path.replace(/^\/+|\/+$/g, ''); this.key = this.path.split('/').pop(); }
    child(path) { return new Ref(this.path + '/' + path); }
    toString() { return 'mock://database/' + this.path; }
    async once() {
      reads.push(this.path);
      if (window.__firebaseDenyNextJoin && /^rooms\/[^/]+\/boards$/.test(this.path)) {
        window.__firebaseDenyNextJoin = false; throw new Error('Connection interrupted');
      }
      if (window.__firebaseDenied?.includes(this.path)) throw new Error('PERMISSION_DENIED');
      return new Snapshot(this.path);
    }
    on(event, callback, error) {
      if (window.__firebaseDenied?.includes(this.path)) { queueMicrotask(() => error?.(new Error('PERMISSION_DENIED'))); return callback; }
      const listener = { path: this.path, event, callback, previous: null };
      listeners.push(listener); queueMicrotask(() => deliver(listener, true)); return callback;
    }
    off(event, callback) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const listener = listeners[i];
        if (listener.path === this.path && (!event || listener.event === event) && (!callback || listener.callback === callback)) listeners.splice(i, 1);
      }
    }
    async set(value) { if (window.__firebaseFailWrites) throw new Error('Connection interrupted'); set(this.path, value); flush(); }
    async update(updates) {
      if (window.__firebaseFailWrites) throw new Error('Connection interrupted');
      Object.entries(updates).forEach(([path, value]) => set(this.path + '/' + path, value)); flush();
    }
    remove() { return this.set(null); }
    onDisconnect() { return { remove: () => Promise.resolve() }; }
    async transaction(callback) {
      // RTDB drops the local snapshot after one-time reads. Transactions at an
      // unwatched location may first receive null, even for an existing room.
      const pinned = listeners.some(listener => listener.event === 'value' && listener.path === this.path);
      let result = callback(pinned ? clone(get(this.path)) : null);
      if (result === undefined) return { committed: false, snapshot: new Snapshot(this.path) };
      if (window.__firebaseBeforeTransaction) {
        const change = window.__firebaseBeforeTransaction; window.__firebaseBeforeTransaction = null; change();
        result = callback(clone(get(this.path)));
      }
      if (result === undefined) return { committed: false, snapshot: new Snapshot(this.path) };
      await this.set(result); return { committed: true, snapshot: new Snapshot(this.path) };
    }
  }
  window.__firebaseData = () => clone(data);
  window.__firebaseUpdate = updates => new Ref('').update(updates);
  window.__firebaseListenerCount = () => listeners.length;
  window.addEventListener('storage', event => {
    if (event.key === 'test-firebase') { data = JSON.parse(event.newValue); listeners.slice().forEach(listener => deliver(listener)); }
  });
  const database = () => ({ ref: path => new Ref(path) });
  database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  window.firebase = { apps: [], initializeApp() { this.apps.push({}); }, database };
})();
