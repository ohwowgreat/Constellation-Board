// The catalog lives within each room's existing read/write boundary. Full-size
// images stay on board items; this index contains only thumbnails and metadata.
const ImageCatalog = {
  cache: new Map(), migrations: new Map(),
  safeSource(src) { return typeof src === 'string' && /^(data:image\/[a-z0-9.+-]+[;,]|https?:\/\/)/i.test(src); },
  async hash(src) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  },
  async image(src) {
    return new Promise((resolve, reject) => {
      const img = new Image(), timer = setTimeout(() => { img.src = ''; reject(new Error('Image loading timed out.')); }, 10000);
      if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Image could not be loaded.')); };
      img.src = src;
    });
  },
  async record(item) {
    if (!item || item.type !== 'image' || !this.safeSource(item.src)) return null;
    let pending = this.cache.get(item.src);
    if (!pending) {
      pending = (async () => {
        const hash = await this.hash(item.src);
        let width = 0, height = 0, thumbnail = '';
        try {
          const img = await this.image(item.src);
          width = img.naturalWidth; height = img.naturalHeight;
          const scale = Math.min(1, 320 / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          thumbnail = canvas.toDataURL('image/jpeg', .72);
        } catch (_) { /* A broken or non-CORS image still gets a searchable entry. */ }
        return { hash, width, height, thumbnail };
      })();
      this.cache.set(item.src, pending);
      if (this.cache.size > 150) this.cache.delete(this.cache.keys().next().value);
      pending.catch(() => this.cache.delete(item.src));
    }
    return { ...await pending, label: String(item.label || 'Untitled image').slice(0, 300) };
  },
  async indexBoards(itemsByBoard) {
    const indexed = {}, jobs = [];
    Object.entries(itemsByBoard || {}).forEach(([boardId, items]) => {
      Object.entries(items || {}).forEach(([itemId, item]) => {
        if (item && item.type === 'image') jobs.push({ boardId, itemId, item });
      });
    });
    await this.pool(jobs, async ({ boardId, itemId, item }) => {
      const record = await this.record(item);
      if (record) (indexed[boardId] ||= {})[itemId] = record;
    });
    return indexed;
  },
  async pool(jobs, work, concurrency = 4) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) await work(jobs[next++]);
    }));
  },
  ensureRoom(ref) {
    const key = ref.toString();
    if (this.migrations.has(key)) return this.migrations.get(key);
    const pending = this.migrate(ref).finally(() => this.migrations.delete(key));
    this.migrations.set(key, pending);
    return pending;
  },
  async migrate(ref) {
    // Reading the marker first avoids fetching pixels from already indexed rooms.
    if ((await ref.child('meta/libraryVersion').once('value')).val() === 1) return;
    // A one-time read does not keep RTDB's local cache alive. Without an active
    // listener, the first transaction callback can see null and abort locally,
    // even though the room exists. Pin the snapshot only during this backfill.
    const keepSnapshot = () => {};
    ref.on('value', keepSnapshot, () => {});
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const room = (await ref.once('value')).val();
        if (!room || room.meta?.libraryVersion === 1) return;
        const signature = JSON.stringify(room.items || {});
        const indexed = await this.indexBoards(room.items);
        // Preserve concurrent edits and never resurrect a removed image.
        const result = await ref.transaction(current => {
          if (!current || current.meta?.libraryVersion === 1 || JSON.stringify(current.items || {}) !== signature) return;
          return { ...current, imageLibrary: indexed, meta: { ...(current.meta || {}), libraryVersion: 1 } };
        }, undefined, false);
        if (result.committed) return;
      }
      if ((await ref.child('meta/libraryVersion').once('value')).val() !== 1) throw new Error('This room is changing. Refresh to finish loading its images.');
    } finally {
      ref.off('value', keepSnapshot);
    }
  }
};

const Library = {
  open: false, busy: false, rooms: new Map(), entries: new Map(), selected: new Set(),
  directoryRef: null, directoryCallback: null, directoryError: '', directoryLoading: false,
  generation: 0, renderTimer: null, previewToken: 0, createdRoom: null, fitTarget: null,
  $(id) { return document.getElementById(id); },
  init() {
    this.$('library-btn').addEventListener('click', () => this.setOpen(!this.open));
    this.$('library-close').addEventListener('click', () => this.setOpen(false));
    this.$('library-search').addEventListener('input', () => this.render());
    this.$('library-room').addEventListener('change', () => { this.$('library-board').value = ''; this.render(); });
    this.$('library-board').addEventListener('change', () => this.render());
    this.$('library-refresh').addEventListener('click', () => { this.stop(); this.watch(); });
    this.$('library-clear').addEventListener('click', () => { this.selected.clear(); this.render(); });
    this.$('library-create').addEventListener('click', () => {
      this.$('library-master-error').textContent = '';
      this.$('library-master-help').textContent = `${this.selected.size} selected image${this.selected.size === 1 ? '' : 's'} will be copied into a new shared room.`;
      this.$('library-master-submit').textContent = this.createdRoom ? 'Open saved master board' : 'Create shared room';
      this.$('library-master').showModal();
      this.$('library-master-name').focus();
    });
    this.$('library-master-form').addEventListener('submit', e => { e.preventDefault(); this.createMaster(); });
    this.$('library-master-cancel').addEventListener('click', () => this.$('library-master').close());
    this.$('library-master').addEventListener('cancel', e => { if (this.busy) e.preventDefault(); });
    this.$('library-preview-close').addEventListener('click', () => this.$('library-preview').close());
    this.$('library-preview').addEventListener('close', () => {
      this.previewToken++; this.$('library-preview-image').removeAttribute('src');
    });
    this.$('library-gallery').addEventListener('change', e => {
      const hash = e.target.dataset.select;
      if (!hash) return;
      if (e.target.checked) this.selected.add(hash); else this.selected.delete(hash);
      e.target.closest('.library-image').classList.toggle('selected', e.target.checked);
      this.renderSelection();
    });
    this.$('library-gallery').addEventListener('click', e => {
      const hash = e.target.closest('[data-preview]')?.dataset.preview;
      if (hash) this.preview(hash);
    });
  },
  setOpen(open) {
    if (this.busy) return;
    this.open = open;
    this.$('image-library').hidden = !open;
    this.$('library-btn').setAttribute('aria-expanded', String(open));
    this.$('library-btn').classList.toggle('active', open);
    document.getElementById('canvas').inert = open;
    document.getElementById('rooms-panel').inert = open;
    document.getElementById('toolbar').hidden = open;
    if (open) { this.watch(); this.render(); this.$('library-search').focus(); }
    else { this.stop(); this.$('library-btn').focus(); }
  },
  watch() {
    if (this.directoryRef || !Live.available()) return;
    Live.init();
    this.directoryLoading = true; this.directoryError = '';
    const generation = ++this.generation;
    this.directoryRef = Live.db.ref('directory');
    this.directoryCallback = snapshot => {
      if (generation !== this.generation) return;
      this.directoryLoading = false; this.directoryError = '';
      const present = new Set();
      snapshot.forEach(child => {
        if (!/^[A-Z0-9]{4,12}$/.test(child.key)) return;
        const info = child.val() || {}; present.add(child.key);
        const state = this.rooms.get(child.key);
        if (state) state.name = info.name || 'Untitled room';
        else this.watchRoom(child.key, info.name || 'Untitled room', generation);
      });
      this.rooms.forEach((state, code) => { if (!present.has(code)) { this.detachRoom(state); this.rooms.delete(code); } });
      this.rebuild();
    };
    this.directoryRef.on('value', this.directoryCallback, error => {
      if (generation !== this.generation) return;
      this.directoryLoading = false; this.directoryError = friendlyError(error); this.render();
    });
  },
  async watchRoom(code, name, generation) {
    const ref = Live.db.ref('rooms/' + code);
    const state = { code, name, ref, boards: {}, index: {}, ready: false, error: '', listeners: [] };
    this.rooms.set(code, state);
    try {
      await ImageCatalog.ensureRoom(ref);
      if (generation !== this.generation || this.rooms.get(code) !== state) return;
      let boardsLoaded = false, indexLoaded = false;
      const watch = (path, assign) => {
        const childRef = ref.child(path);
        const callback = snapshot => {
          if (generation !== this.generation) return;
          assign(snapshot.val() || {});
          state.ready = boardsLoaded && indexLoaded && !state.error; this.rebuild();
        };
        state.listeners.push({ ref: childRef, callback });
        childRef.on('value', callback, error => {
          if (generation !== this.generation) return;
          state.error = friendlyError(error); state.ready = false; this.rebuild();
        });
      };
      watch('boards', value => { state.boards = value; boardsLoaded = true; });
      watch('imageLibrary', value => { state.index = value; indexLoaded = true; });
    } catch(error) {
      if (generation !== this.generation) return;
      state.error = friendlyError(error); this.rebuild();
    }
  },
  detachRoom(state) { state.listeners.forEach(({ ref, callback }) => ref.off('value', callback)); },
  stop() {
    this.generation++; clearTimeout(this.renderTimer);
    if (this.directoryRef) this.directoryRef.off('value', this.directoryCallback);
    this.directoryRef = null; this.directoryCallback = null;
    this.rooms.forEach(state => this.detachRoom(state)); this.rooms.clear();
  },
  rebuild() {
    const entries = new Map();
    this.rooms.forEach(state => {
      if (!state.ready) return;
      Object.entries(state.index).forEach(([boardId, items]) => {
        if (!state.boards[boardId]) return;
        Object.entries(items || {}).forEach(([itemId, record]) => {
          if (!record || !/^[a-f0-9]{64}$/.test(record.hash)) return;
          let entry = entries.get(record.hash);
          if (!entry) { entry = { ...record, label: record.label || 'Untitled image', sources: [] }; entries.set(record.hash, entry); }
          entry.sources.push({ code: state.code, room: state.name, boardId, board: state.boards[boardId].name || 'Board', itemId, label: record.label || 'Untitled image' });
        });
      });
    });
    this.entries = entries;
    // Loading is incremental: wait for every room before pruning a selection.
    if (this.complete()) this.selected.forEach(hash => { if (!entries.has(hash)) this.selected.delete(hash); });
    clearTimeout(this.renderTimer); this.renderTimer = setTimeout(() => this.render(), 60);
  },
  complete() { return !this.directoryLoading && !this.directoryError && [...this.rooms.values()].every(room => room.ready); },
  settled() { return !this.directoryLoading && !this.directoryError && [...this.rooms.values()].every(room => room.ready || room.error); },
  optionList(select, options, placeholder) {
    const previous = select.value;
    select.replaceChildren(new Option(placeholder, ''), ...options.map(([value, label]) => new Option(label, value)));
    if (options.some(([value]) => value === previous)) select.value = previous;
  },
  render() {
    if (!this.open) return;
    const focused = document.activeElement?.dataset;
    const focusHash = focused?.select || focused?.preview, focusType = focused?.select ? 'select' : 'preview';
    const roomSelect = this.$('library-room'), boardSelect = this.$('library-board');
    this.optionList(roomSelect, [...this.rooms.values()].sort((a, b) => a.name.localeCompare(b.name)).map(room => [room.code, room.name + ' · ' + room.code]), 'All rooms');
    const boardOptions = [];
    this.rooms.forEach(room => {
      if (roomSelect.value && roomSelect.value !== room.code) return;
      Object.entries(room.boards).forEach(([id, board]) => boardOptions.push([room.code + '/' + id, roomSelect.value ? board.name || 'Board' : room.name + ' / ' + (board.name || 'Board')]));
    });
    this.optionList(boardSelect, boardOptions, 'All boards');
    const search = this.$('library-search').value.trim().toLocaleLowerCase();
    const visible = [...this.entries.values()].filter(entry => entry.sources.some(source =>
      (!roomSelect.value || source.code === roomSelect.value) &&
      (!boardSelect.value || source.code + '/' + source.boardId === boardSelect.value) &&
      (!search || [source.label, source.room, source.board].some(value => value.toLocaleLowerCase().includes(search)))
    ));
    visible.sort((a, b) => a.label.localeCompare(b.label) || a.hash.localeCompare(b.hash));
    const pending = [...this.rooms.values()].filter(room => !room.ready && !room.error).length;
    const failures = [...this.rooms.values()].filter(room => room.error);
    const status = this.$('library-status');
    if (!Live.configured()) status.textContent = 'Set up live rooms under Share to use the image library.';
    else if (!Live.available()) status.textContent = 'Live sharing could not load. Check your connection and reload the page.';
    else if (this.directoryError) status.textContent = this.directoryError + ' Use Refresh to try again.';
    else if (this.directoryLoading) status.textContent = 'Loading rooms…';
    else {
      status.textContent = `${visible.length} of ${this.entries.size} images · ${this.rooms.size} rooms`;
      if (pending) status.textContent += ` · Loading ${pending} room${pending === 1 ? '' : 's'}…`;
      if (failures.length) status.textContent += ` · Could not load: ${failures.map(room => room.name).join(', ')}. Use Refresh to try again.`;
    }
    this.$('library-gallery').setAttribute('aria-busy', String(this.directoryLoading || pending > 0));
    const grid = document.createElement('div'); grid.className = 'library-grid';
    visible.forEach(entry => grid.appendChild(this.card(entry)));
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'library-empty';
      const title = document.createElement('h3'), copy = document.createElement('p');
      title.textContent = pending || this.directoryLoading ? 'Gathering room images…' : failures.length || this.directoryError ? 'Room images could not load' : this.entries.size ? 'No matching images' : 'No room images yet';
      copy.textContent = pending ? 'Older rooms may take a moment to load the first time.' : failures.length || this.directoryError ? 'Use Refresh to try again. Your images remain on their room boards.' : this.entries.size ? 'Try another room, board, or search.' : 'Add images to a shared room board. They will appear here while they remain on a room board.';
      empty.append(title, copy); grid.appendChild(empty);
    }
    this.$('library-gallery').replaceChildren(grid); this.renderSelection();
    if (focusHash) this.$('library-gallery').querySelector(`[data-${focusType}="${focusHash}"]`)?.focus();
  },
  card(entry) {
    const article = document.createElement('article'); article.className = 'library-image' + (this.selected.has(entry.hash) ? ' selected' : '');
    const preview = document.createElement('button'); preview.className = 'library-thumb'; preview.dataset.preview = entry.hash;
    preview.setAttribute('aria-label', 'Preview ' + entry.label);
    const img = document.createElement('img'); img.alt = ''; img.loading = 'lazy';
    if (/^data:image\/jpeg[;,]/i.test(entry.thumbnail || '')) img.src = entry.thumbnail; else preview.classList.add('broken');
    img.addEventListener('error', () => preview.classList.add('broken'));
    const unavailable = document.createElement('span'); unavailable.className = 'library-unavailable'; unavailable.textContent = 'Preview unavailable';
    preview.append(img, unavailable);
    const title = document.createElement('div'); title.className = 'library-image-title';
    const label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('span');
    check.type = 'checkbox'; check.dataset.select = entry.hash; check.checked = this.selected.has(entry.hash); name.textContent = entry.label;
    label.append(check, name); title.appendChild(label);
    const sources = document.createElement('p'); sources.className = 'library-sources'; sources.textContent = this.sourceNames(entry).join(' · ');
    article.append(preview, title, sources); return article;
  },
  sourceNames(entry) { return [...new Set(entry.sources.map(source => source.room + ' / ' + source.board))]; },
  renderSelection() {
    this.$('library-selected').textContent = `${this.selected.size} selected`;
    this.$('library-clear').disabled = !this.selected.size || this.busy;
    this.$('library-create').disabled = this.busy || !Live.available() || (!this.createdRoom &&
      (!this.selected.size || !this.settled() || [...this.selected].some(hash => !this.entries.has(hash))));
  },
  async resolve(entry) {
    if (!entry) throw new Error('This image is no longer on a room board. Refresh the library.');
    for (const source of entry.sources) {
      const item = (await Live.db.ref(`rooms/${source.code}/items/${source.boardId}/${source.itemId}`).once('value')).val();
      if (item?.type === 'image' && ImageCatalog.safeSource(item.src) && await ImageCatalog.hash(item.src) === entry.hash) return item;
    }
    throw new Error('A selected image was removed from its room. Refresh the library and update your selection.');
  },
  async preview(hash) {
    const entry = this.entries.get(hash); if (!entry) return;
    const token = ++this.previewToken, image = this.$('library-preview-image'), status = this.$('library-preview-status');
    this.$('library-preview-title').textContent = entry.label;
    this.$('library-preview-sources').textContent = this.sourceNames(entry).join(' · ');
    image.hidden = true; image.removeAttribute('src'); status.textContent = 'Loading image…';
    this.$('library-preview').showModal();
    try {
      const item = await this.resolve(entry);
      if (token !== this.previewToken) return;
      image.onload = () => { if (token === this.previewToken) { status.textContent = ''; image.hidden = false; } };
      image.onerror = () => { if (token === this.previewToken) status.textContent = 'This image could not load. Close the preview and try again.'; };
      image.alt = entry.label; image.src = item.src;
    } catch(error) { if (token === this.previewToken) status.textContent = error.message; }
  },
  async createMaster() {
    if (this.busy) return;
    const name = cleanName(this.$('library-master-name').value, 80);
    if (!name) { this.$('library-master-error').textContent = 'Give the master board a name.'; return; }
    if (!this.createdRoom && (!this.selected.size || !this.settled() || [...this.selected].some(hash => !this.entries.has(hash)))) {
      this.$('library-master-error').textContent = 'Some selected images are unavailable. Refresh the library or update your selection.'; return;
    }
    this.busy = true; this.$('library-master-error').textContent = '';
    this.$('library-master-submit').disabled = true; this.$('library-master-submit').textContent = 'Creating room…';
    this.$('library-master-cancel').disabled = true; this.$('library-close').disabled = true;
    try {
      if (!this.createdRoom) {
        const hashes = [...this.selected], entries = hashes.map(hash => this.entries.get(hash)), images = new Array(hashes.length);
        await ImageCatalog.pool(entries.map((entry, i) => ({ entry, i })), async ({ entry, i }) => { images[i] = await this.resolve(entry); });
        const board = defaultBoard(name), columns = Math.min(5, Math.ceil(Math.sqrt(images.length)));
        board.items = images.map((item, i) => {
          const entry = entries[i];
          const ratio = entry.width > 0 && entry.height > 0 ? entry.height / entry.width : (item.h || 180) / (item.w || 240);
          const w = Math.min(240, 200 / ratio), h = w * ratio;
          return { id: uid(), type: 'image', src: item.src, label: item.label || entry.label, flipped: !!item.flipped,
            x: 50 + (i % columns) * 280 + (240 - w) / 2, y: 50 + Math.floor(i / columns) * 260, w, h, z: i + 1 };
        });
        const code = await Live.create(board, { name, names: cleanName(this.$('library-master-names').value, 120) }, false);
        this.createdRoom = { code, boardId: board.id, count: board.items.length };
      }
      this.fitTarget = this.createdRoom;
      await Live.join(this.createdRoom.code, this.createdRoom.boardId);
      this.createdRoom = null; this.selected.clear();
      this.$('library-master').close(); this.busy = false; this.setOpen(false);
      this.fitCreatedBoard();
    } catch(error) {
      this.$('library-master-error').textContent = this.createdRoom
        ? `Your master room was saved (${this.createdRoom.code}), but could not open. Try again to open it. ${friendlyError(error)}`
        : friendlyError(error);
    } finally {
      this.busy = false;
      this.$('library-master-submit').disabled = false;
      this.$('library-master-submit').textContent = this.createdRoom ? 'Open saved master board' : 'Create shared room';
      this.$('library-master-cancel').disabled = false; this.$('library-close').disabled = false; this.renderSelection();
    }
  },
  fitCreatedBoard() {
    if (this.fitTarget && liveMode && Live.code === this.fitTarget.code && activeBoardId === this.fitTarget.boardId && nodes.length >= this.fitTarget.count) {
      this.fitTarget = null; requestAnimationFrame(zoomToFit);
    }
  }
};
