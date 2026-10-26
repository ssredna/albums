<script lang="ts">
  import type { Album } from '../lib/spotify';
  import Spine from './Spine.svelte';
  import { playAlbum } from '../lib/player.svelte';
  import { canHover } from '../lib/hover';
  import { preloadCover } from '../lib/covers';
  import { cachedColor, placeholderColor, spineColor, type SpineColor } from '../lib/color';
  import { SvelteMap } from 'svelte/reactivity';
  import { byArtist } from '../lib/sort';
  import Crate, { UNPACK_MS, SLIDE_EASING } from './Crate.svelte';
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let { albums, onsignout }: { albums: Album[]; onsignout: () => void } = $props();

  // The rack is the listener's own: shelves they add, label and order, each holding the albums they
  // put there. Everything not on a shelf waits in the crate, alphabetical, to be sorted. (In the code
  // below, a `Section` is one of those shelves and a `Shelf` the board it stands on. A crowded section
  // squeezes its records together, and only carries on over a second board when they won't fit even
  // then, as can happen when the window narrows.) There can be several racks side by side, shown one
  // at a time and stepped between with the arrows at the sides.
  type Section = { id: string; label: string; albums: string[] };
  type RackLayout = { id: string; sections: Section[] };

  const RACKS_KEY = 'rack:racks';
  const HERE_KEY = 'rack:here';
  const emptyShelf = (): Section => ({ id: crypto.randomUUID(), label: '', albums: [] });
  // A new rack is one empty shelf.
  const emptyRack = (): RackLayout => ({ id: crypto.randomUUID(), sections: [emptyShelf()] });
  const blank = (r: RackLayout) => r.sections.every((s) => !s.label && !s.albums.length);
  // A new listener starts with one empty rack, and every album in the crate.
  let racks = $state.raw<RackLayout[]>(readRacks());
  let here = $state(readHere());
  let openId = $state<string | null>(null);
  // Which way the rack last turned, so the next one slides in from that side.
  let turned = $state(1);

  const layout = $derived(racks[here].sections);

  function readRacks(): RackLayout[] {
    try {
      const saved = JSON.parse(localStorage.getItem(RACKS_KEY) ?? 'null');
      if (Array.isArray(saved) && saved.length) return saved;
      // From when there was only the one rack.
      const sections = readLayout();
      localStorage.removeItem('rack:layout');
      if (sections) return [{ id: crypto.randomUUID(), sections }];
    } catch {}
    return [emptyRack()];
  }

  function readHere() {
    try {
      const saved = Number(localStorage.getItem(HERE_KEY));
      if (Number.isInteger(saved)) return Math.min(Math.max(saved, 0), racks.length - 1);
    } catch {}
    return 0;
  }

  function readLayout(): Section[] | null {
    try {
      localStorage.removeItem('rack:sort'); // from when the rack could only be sorted
      localStorage.removeItem('rack:shelves'); // from when a shelf could run over several boards
      const saved = JSON.parse(localStorage.getItem('rack:layout') ?? 'null');
      if (Array.isArray(saved) && saved.length) return saved;
      // From before the crate: unlabelled shelves were records still waiting to be sorted, so
      // they're tipped into the crate and only the labelled ones are kept.
      const rows = JSON.parse(localStorage.getItem('rack:rows') ?? 'null');
      localStorage.removeItem('rack:rows');
      if (Array.isArray(rows)) {
        const kept = rows.filter((s: Section) => s.label);
        return kept.length ? kept : null;
      }
    } catch {}
    return null;
  }

  $effect(() => {
    try {
      localStorage.setItem(RACKS_KEY, JSON.stringify(racks));
      localStorage.setItem(HERE_KEY, String(here));
    } catch {}
  });

  // Albums no longer saved drop out.
  function arrange(albums: Album[], layout: Section[]) {
    const byId = new Map(albums.map((a) => [a.id, a]));
    return layout.map((section) => ({ ...section, albums: section.albums.flatMap((id) => byId.get(id) ?? []) }));
  }

  const sections = $derived(arrange(albums, layout));
  const where = $derived(
    new Map(sections.flatMap((s, shelf) => s.albums.map((a, index) => [a.id, { shelf, index }] as const))),
  );
  // On a shelf of any rack.
  const shelved = $derived(new Set(racks.flatMap((r) => r.sections.flatMap((s) => s.albums))));
  // Including albums saved since the rack was last arranged.
  const crate = $derived(albums.filter((a) => !shelved.has(a.id)).sort(byArtist));

  // Every change starts from the rack as shown, so missing albums are let go.
  const current = (): Section[] => sections.map((s) => ({ ...s, albums: s.albums.map((a) => a.id) }));

  function commit(next: Section[]) {
    racks = racks.map((r, i) => (i === here ? { ...r, sections: next } : r));
  }

  const without = (sections: Section[], ids: Set<string>) =>
    sections.map((s) => (s.albums.some((a) => ids.has(a)) ? { ...s, albums: s.albums.filter((a) => !ids.has(a)) } : s));

  // Moves albums (from shelves of this rack or others, or the crate) onto shelf `shelf`, in the
  // order given, before the album at `to` there (or at its end).
  function moveAlbums(ids: string[], shelf: number, to: number) {
    const moving = new Set(ids);
    const next = current();
    const before = next[shelf].albums.slice(to).find((id) => !moving.has(id));
    const stay = without(next, moving);
    const landing = stay[shelf].albums;
    landing.splice(before ? landing.indexOf(before) : landing.length, 0, ...ids);
    racks = racks.map((r, i) => ({ ...r, sections: i === here ? stay : without(r.sections, moving) }));
  }

  const moveAlbum = (id: string, shelf: number, to: number) => moveAlbums([id], shelf, to);

  // Puts albums back in the crate, from whichever racks they're on.
  function unsort(ids: string[]) {
    const going = new Set(ids);
    racks = racks.map((r) => ({ ...r, sections: without(r.sections, going) }));
  }

  // Moves shelf `id` over from another rack, to sit before the shelf at `to` here (or at the bottom).
  // A rack left with no shelves is taken down.
  function carryShelf(id: string, to: number) {
    const origin = racks.findIndex((r) => r.sections.some((s) => s.id === id));
    if (origin < 0 || origin === here) return;
    const section = racks[origin].sections.find((s) => s.id === id)!;
    // It takes the place of a new rack's empty shelf.
    const next = blank(racks[here]) ? [] : current();
    next.splice(to, 0, section);
    const left = racks[origin].sections.filter((s) => s.id !== id);
    racks = racks
      .map((r, i) => (i === here ? { ...r, sections: next } : i === origin ? { ...r, sections: left } : r))
      .filter((r) => r.sections.length);
    if (!left.length && origin < here) here--;
  }

  // Records picked out with Cmd/Ctrl-click (one at a time) or Shift-click (a run along the rack),
  // to be dragged, or put back in the crate, all together. While any are picked out, records stay
  // shut, and a plain click picks one out or puts it back too.
  let selected = $state.raw(new Set<string>());
  let anchor: string | null = null;

  function select(e: MouseEvent) {
    const id = (e.target as Element).closest<HTMLElement>('.slot')?.dataset.id;
    if (!id || !(e.metaKey || e.ctrlKey || e.shiftKey || selected.size)) return;
    e.preventDefault();
    e.stopPropagation();
    putEverythingBack();
    const next = new Set(selected);
    const order = sections.flatMap((s) => s.albums.map((a) => a.id));
    const from = anchor ? order.indexOf(anchor) : -1;
    if (e.shiftKey && from >= 0) {
      const to = order.indexOf(id);
      for (const a of order.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(a);
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    anchor = id;
    selected = next;
  }

  const saved = $derived(new Set(albums.map((a) => a.id)));

  // Spine colours for the map, sampled for records on racks not looked at yet too.
  const sampled = new SvelteMap<string, SpineColor>();
  const asked = new Set<string>();
  const colorOf = (id: string) => (sampled.get(id) ?? cachedColor(id) ?? placeholderColor(id)).bg;

  $effect(() => {
    for (const { id, thumb } of albums) {
      if (!shelved.has(id) || !thumb || asked.has(id) || cachedColor(id)) continue;
      asked.add(id);
      spineColor(id, thumb).then((color) => sampled.set(id, color));
    }
  });

  // The selection in rack order, leaving out any albums no longer saved.
  const picked = () =>
    racks.flatMap((r) => r.sections.flatMap((s) => s.albums)).filter((id) => selected.has(id) && saved.has(id));

  function deselect() {
    selected = new Set();
    anchor = null;
  }

  // Goes to rack `to`. Just past the last there's room for a new one, and a rack left with nothing
  // on it is taken down.
  function go(to: number) {
    if (to === here || to < 0 || to > racks.length || (to === racks.length && blank(racks[here]))) return;
    putEverythingBack();
    turned = Math.sign(to - here);
    let next = to === racks.length ? [...racks, emptyRack()] : racks;
    if (blank(racks[here])) {
      next = next.filter((_, i) => i !== here);
      if (to > here) to--;
    }
    racks = next;
    here = to;
  }

  const turn = (step: number) => go(here + step);

  async function addShelf(at: number) {
    const next = current();
    const id = crypto.randomUUID();
    next.splice(at, 0, { ...emptyShelf(), id });
    commit(next);
    await tick();
    rack?.querySelector<HTMLInputElement>(`[data-section="${id}"] .label`)?.focus();
  }

  // A removed shelf's albums go back in the crate. Removing a rack's last shelf takes the rack down.
  function removeShelf(i: number) {
    const next = current();
    const [gone] = next.splice(i, 1);
    if (!next.length && racks.length === 1) return;
    const count = gone.albums.length;
    const name = gone.label ? `“${gone.label}”` : 'this shelf';
    const them = count === 1 ? 'Its album goes' : `Its ${count} albums go`;
    if (count && !confirm(`Remove ${name}? ${them} back in the crate.`)) return;
    if (next.length) return commit(next);
    racks = racks.filter((_, r) => r !== here);
    here = Math.max(here - 1, 0);
  }

  function renameShelf(i: number, label: string) {
    const next = current();
    next[i].label = label.trim();
    commit(next);
  }

  // Moves shelf `from` so it sits before the shelf at `to` (or at the bottom).
  function moveShelf(from: number, to: number) {
    const next = current();
    const [section] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, section);
    commit(next);
  }

  // Shelves are packed once for the current width, so pulling a record out only nudges its own
  // shelf-mates and never reflows the other shelves.
  type Item = { album: Album; width: number; side: 'left' | 'right' };
  // `room` is what the closed spines of a hover shelf squeeze into while one of them is open.
  type Shelf = { items: Item[]; room: number | null };

  const GAP = 1;
  const MIN_SPINE = 24;
  const MAX_SPINE = 46;
  const MIN_SCALE = 0.6; // how tightly a crowded shelf squeezes its records before it needs another board
  // Thicker spines for longer records, like a real shelf.
  const spineWidth = (album: Album) => Math.min(MAX_SPINE, Math.max(MIN_SPINE, 20 + album.tracks * 1.2));

  let available = $state(0);
  let coverSize = $state(0);
  const hover = $derived(canHover.current);
  const rows = $derived(sections.map((section) => pack(section.albums, available, coverSize, hover)));

  // With a mouse, shelves leave room for one cover, so a record opens without pushing its
  // shelf-mates off the edge. On touch, shelves are full and the open record pushes them aside.
  const budgetFor = (available: number, coverSize: number, hover: boolean) =>
    hover ? Math.max(available - coverSize + MIN_SPINE, MIN_SPINE) : available;

  const span = (albums: Album[], width: (album: Album) => number) =>
    albums.reduce((sum, album) => sum + width(album), 0) + GAP * (albums.length - 1);

  // Fills boards from the left, starting a new one whenever the next record won't fit.
  function fill(albums: Album[], width: (album: Album) => number, budget: number): Album[][] {
    const boards: Album[][] = [];
    let board: Album[] = [];
    let used = 0;
    for (const album of albums) {
      const w = width(album);
      if (board.length && used + GAP + w > budget) {
        boards.push(board);
        board = [];
        used = 0;
      }
      used += (board.length ? GAP : 0) + w;
      board.push(album);
    }
    if (board.length) boards.push(board);
    return boards;
  }

  // A shelf too crowded for one board goes over as few as it needs, shared out evenly.
  function spread(albums: Album[], budget: number): Album[][] {
    const count = fill(albums, (a) => spineWidth(a) * MIN_SCALE, budget).length;
    const share = (span(albums, spineWidth) + GAP) / count;
    const boards: Album[][] = Array.from({ length: count }, () => []);
    let x = 0;
    for (const album of albums) {
      const width = spineWidth(album);
      boards[Math.min(count - 1, Math.floor((x + width / 2) / share))].push(album);
      x += width + GAP;
    }
    return boards;
  }

  // A shelf about as full as it gets is stretched or squeezed to fill the board exactly; one with
  // room to spare keeps its records at their own width.
  function pack(albums: Album[], available: number, coverSize: number, hover: boolean): Shelf[] {
    if (!available || !coverSize || !albums.length) return [];
    const budget = budgetFor(available, coverSize, hover);
    const boards = span(albums, spineWidth) <= budget ? [albums] : spread(albums, budget);
    return boards.map((board) => {
      const gaps = GAP * (board.length - 1);
      const natural = span(board, spineWidth) - gaps;
      const full = board.length > 1 && natural + gaps > budget - MAX_SPINE;
      if (!full) return { items: placeSpines(board, available, 1, hover), room: null };
      if (!hover) return { items: placeSpines(board, available, (available - gaps) / natural, false), room: null };
      // Sized so that opening an average record fills the shelf; `room` evens out the rest.
      const scale = (available - coverSize - gaps) / (natural - natural / board.length);
      return { items: placeSpines(board, available, scale, true), room: available - coverSize - gaps };
    });
  }

  function placeSpines(shelf: Album[], available: number, scale: number, hover: boolean): Item[] {
    let x = 0;
    return shelf.map((album) => {
      const width = spineWidth(album) * scale;
      // Hover shelves always open rightwards into their spare room, so the cover stays under the mouse.
      const side = hover || x + width / 2 < available / 2 ? 'right' : 'left';
      x += width + GAP;
      return { album, width, side };
    });
  }

  // While a record on a full hover shelf is open, its shelf-mates share what's left exactly.
  function widthOf(shelf: Shelf, item: Item, openAlbum: string | null) {
    const open = shelf.items.find((i) => i.album.id === openAlbum);
    if (!open || open === item || shelf.room === null) return item.width;
    const rest = shelf.items.reduce((sum, i) => sum + i.width, 0) - open.width;
    return (item.width * shelf.room) / rest;
  }

  // A record in the right half swings out to the left: shift the shelf left by as much as the
  // record grows, so everything to its right stays put.
  function shift(shelf: Shelf) {
    const item = shelf.items.find((i) => i.album.id === openId);
    return item?.side === 'left' ? `translateX(calc(${item.width}px - var(--h)))` : undefined;
  }

  // Hovering leafs through a shelf like a finger along the records. An open cover holds the mouse
  // until it crosses one of the cover's edges, which leafs on to the next record that way. A fast
  // move past the edge counts spines on the closed shelf, and the finger then steps through every
  // record on the way, one per frame, so a fast sweep flips each of them instead of skipping them.
  // A record put back by click stays shut until the mouse moves to another one.
  const LEAVE_DELAY = 250;
  const STEP_MS = 16;
  const MAX_LAG = 10; // records the finger may trail the mouse by, so it never falls far behind
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissedId: string | null = null;
  let finger: { shelf: Shelf; index: number; target: number } | null = null;
  let frame = 0;
  let lastStep = 0;

  // Full hover shelves are centred in the row's content box (overflowing both sides alike, as
  // flexbox does). A shelf that isn't full lines up with where full ones start, under its label,
  // and only slides left when an open cover would otherwise run past the end.
  const inset = $derived(Math.max(0, (coverSize - 32) / 2));
  const startOf = (shelf: Shelf, width: number) =>
    shelf.room === null ? Math.max(0, Math.min(inset, available - width)) : (available - width) / 2;

  function shelfLeft(shelf: Shelf, row: HTMLElement, width: number) {
    const gutter = parseFloat(getComputedStyle(row).paddingRight);
    return row.getBoundingClientRect().left + gutter + startOf(shelf, width);
  }

  // How far in a part-filled hover shelf starts right now, with `open` turned out.
  function partStart(shelf: Shelf, open: string | null) {
    const widths = shelf.items.map((item) => (item.album.id === open ? coverSize : item.width));
    return startOf(shelf, widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1));
  }

  // Where record `i` starts on the closed shelf.
  function closedLeft(shelf: Shelf, row: HTMLElement, i: number) {
    const width = shelf.items.reduce((sum, i) => sum + i.width, 0) + GAP * (shelf.items.length - 1);
    let x = shelfLeft(shelf, row, width);
    for (let j = 0; j < i; j++) x += shelf.items[j].width + GAP;
    return x;
  }

  function indexAt(shelf: Shelf, row: HTMLElement, x: number) {
    let edge = closedLeft(shelf, row, 0);
    for (let i = 0; i < shelf.items.length; i++) {
      edge += shelf.items[i].width + GAP;
      if (x < edge) return i;
    }
    return shelf.items.length - 1;
  }

  // Where record `i`'s cover ends up once it has opened. Worked out rather than measured, since the
  // shelf is usually still animating.
  function coverAt(shelf: Shelf, row: HTMLElement, i: number) {
    const id = shelf.items[i].album.id;
    const widths = shelf.items.map((item, j) => (j === i ? coverSize : widthOf(shelf, item, id)));
    let left = shelfLeft(shelf, row, widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1));
    for (let j = 0; j < i; j++) left += widths[j] + GAP;
    return { left, right: left + coverSize };
  }

  function hoverShelf(shelf: Shelf, e: PointerEvent & { currentTarget: HTMLElement }) {
    // Records stay shut while several are being picked out.
    const picking = e.metaKey || e.ctrlKey || e.shiftKey || selected.size;
    if (!hover || draggingId || e.pointerType !== 'mouse' || picking) return;
    clearTimeout(leaveTimer);
    const row = e.currentTarget;
    const x = e.clientX;

    if (!finger || finger.shelf !== shelf || !shelf.items.some((i) => i.album.id === openId)) {
      const target = indexAt(shelf, row, x);
      const id = shelf.items[target].album.id;
      if (id === dismissedId) return;
      dismissedId = null;
      stopFinger();
      finger = { shelf, index: target, target };
      openId = id;
      return;
    }

    // Measured against where the finger is heading, so a cover still on its way isn't passed twice.
    const { left, right } = coverAt(shelf, row, finger.target);
    if (x >= left && x <= right) return;
    const past =
      x > right
        ? closedLeft(shelf, row, finger.target + 1) + (x - right)
        : closedLeft(shelf, row, finger.target) - GAP - (left - x);
    const target = indexAt(shelf, row, past);
    if (target === finger.target) return;
    finger.target = target;
    const behind = target - finger.index;
    if (Math.abs(behind) > MAX_LAG) finger.index = target - Math.sign(behind) * MAX_LAG;
    if (!frame) step(performance.now());
  }

  function step(now: number) {
    frame = 0;
    if (!finger || finger.index === finger.target) return;
    if (now - lastStep >= STEP_MS) {
      lastStep = now;
      finger.index += Math.sign(finger.target - finger.index);
      openId = finger.shelf.items[finger.index].album.id;
    }
    if (finger.index !== finger.target) frame = requestAnimationFrame(step);
  }

  function stopFinger() {
    cancelAnimationFrame(frame);
    frame = 0;
    finger = null;
  }

  function hoverOut(e: PointerEvent) {
    if (!hover || e.pointerType !== 'mouse') return;
    leaveTimer = setTimeout(() => {
      stopFinger();
      openId = null;
    }, LEAVE_DELAY);
  }

  // Fetch and decode a shelf's covers as soon as the mouse reaches it, so they're ready when it
  // leafs through.
  function preloadShelf(shelf: Shelf) {
    if (hover) for (const { album } of shelf.items) preloadCover(album.cover);
  }

  function toggle(id: string) {
    clearTimeout(leaveTimer);
    if (openId === id) {
      openId = null;
      dismissedId = id;
    } else {
      openId = id;
    }
  }


  // Albums can be picked up and dropped anywhere on the rack: straight away with a mouse, after a
  // long press on touch so the page still scrolls. Shelves are picked up by their board. A marker
  // shows where things will go; the rack only rearranges once they're dropped, so nothing shifts
  // under the pointer.
  const DRAG_THRESHOLD = 4;
  const SCROLL_SLOP = 8; // how far a finger may wander during the long press before it counts as a scroll
  const LONG_PRESS = 350;
  const EDGE = 80; // how close to the window's top or bottom the pointer scrolls the rack
  const BOARD = 26; // matches --board
  let rack = $state<HTMLElement>();
  let draggingId = $state<string | null>(null);
  let liftedShelf = $state<string | null>(null);
  let marker = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let ghost = $state<{ albums: Album[]; x: number; y: number } | null>(null);
  // A shelf carried to another rack, where its own board can't follow.
  let shelfGhost = $state<{ label: string; count: number; x: number; y: number } | null>(null);
  let dropzone = $state<HTMLElement>();
  let receiving = $state(false);
  // Holding a record or shelf over one of the arrows turns to the next rack, and on to the one after for as
  // long as it's held there.
  const TURN_DELAY = 600;
  // What a held record or shelf is over: an arrow ('-1' or '1'), or a rack on the map (its id).
  let aiming = $state<string | null>(null);
  let aimTimer: ReturnType<typeof setTimeout> | undefined;

  // The crate starts open for a new rack, when there's nothing on the shelves yet.
  const CRATE_KEY = 'rack:crate-open';
  const startOpen = readCrateOpen();
  let crateOpen = $state(startOpen);

  function readCrateOpen() {
    try {
      const saved = localStorage.getItem(CRATE_KEY);
      if (saved) return saved === 'true';
    } catch {}
    return !shelved.size;
  }

  $effect(() => {
    try {
      localStorage.setItem(CRATE_KEY, String(crateOpen));
    } catch {}
  });

  const CRATE = -1; // where a record is headed when it's dropped back in the crate
  let held: {
    id: string;
    // Everything being carried: the selection, when the record picked up is part of it.
    ids: string[];
    el: HTMLElement;
    // Picked out of the crate: a stand-in follows the pointer, as the crate's own card can't leave it.
    crate: boolean;
    pointerId: number;
    mouse: boolean;
    startX: number;
    startY: number;
    x: number;
    y: number;
    // Where on the closed spine the pointer holds it.
    grabX: number;
    grabY: number;
    tx: number;
    ty: number;
    shelf: number;
    to: number | null;
  } | null = null;
  let heldShelf: {
    id: string;
    el: HTMLElement;
    pointerId: number;
    mouse: boolean;
    startX: number;
    startY: number;
    startScroll: number;
    x: number;
    y: number;
    to: number | null;
  } | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let scrollFrame = 0;
  let swallowClick = false;

  function pickUp(e: PointerEvent) {
    if (held || heldShelf || e.button !== 0) return;
    const target = e.target as Element;
    const el = target.closest<HTMLElement>('[data-id]');
    if (!el?.dataset.id || target.closest('.play')) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse) e.preventDefault(); // no text selection
    const { clientX: x, clientY: y } = e;
    const id = el.dataset.id;
    held = {
      id,
      ids: selected.has(id) && selected.size > 1 ? picked() : [id],
      el,
      crate: !!el.closest('[data-crate]'),
      pointerId: e.pointerId,
      mouse,
      startX: x,
      startY: y,
      x,
      y,
      grabX: 0,
      grabY: 0,
      tx: 0,
      ty: 0,
      shelf: -1,
      to: null,
    };
    if (!mouse) pressTimer = setTimeout(lift, LONG_PRESS);
  }

  function lift() {
    if (!held) return;
    const { el, id, ids, startX, startY } = held;
    if (held.crate || ids.length > 1) {
      ghost = { albums: carrying(), x: startX, y: startY };
      if (ids.length > 1) gather();
    } else {
      const rect = el.getBoundingClientRect();
      const closed = parseFloat(el.style.getPropertyValue('--w'));
      // An open record folds back into its spine, which then hangs from the middle of the pointer.
      held.grabX = id === openId ? closed / 2 : Math.min(startX - rect.left, closed);
      held.grabY = startY - rect.top;
    }
    putEverythingBack();
    draggingId = id;
    if (!held.mouse) navigator.vibrate?.(10);
    scrollFrame = requestAnimationFrame(autoScroll);
    follow();
  }

  // The held records, the one under the pointer first, for the stand-in.
  function carrying() {
    const { id, ids } = held!;
    return [id, ...ids.filter((i) => i !== id)].flatMap((i) => albums.find((a) => a.id === i) ?? []);
  }

  function pickUpShelf(e: PointerEvent & { currentTarget: HTMLElement }, from: number) {
    if (held || heldShelf || e.button !== 0 || (e.target as Element).closest('input, button')) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse) e.preventDefault();
    heldShelf = {
      id: sections[from].id,
      el: e.currentTarget.closest<HTMLElement>('.section')!,
      pointerId: e.pointerId,
      mouse,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: scrollY,
      x: e.clientX,
      y: e.clientY,
      to: null,
    };
    if (!mouse) pressTimer = setTimeout(liftShelf, LONG_PRESS);
  }

  function liftShelf() {
    if (!heldShelf) return;
    putEverythingBack();
    liftedShelf = heldShelf.id;
    if (!heldShelf.mouse) navigator.vibrate?.(10);
    scrollFrame = requestAnimationFrame(autoScroll);
    followShelf();
  }

  function putEverythingBack() {
    clearTimeout(leaveTimer);
    stopFinger();
    openId = null;
  }

  function drag(e: PointerEvent) {
    if (heldShelf && e.pointerId === heldShelf.pointerId) {
      heldShelf.x = e.clientX;
      heldShelf.y = e.clientY;
      if (!liftedShelf) {
        const moved = Math.hypot(e.clientX - heldShelf.startX, heldShelf.y - heldShelf.startY);
        if (heldShelf.mouse && moved >= DRAG_THRESHOLD) liftShelf();
        else if (!heldShelf.mouse && moved >= SCROLL_SLOP) release();
        return;
      }
      followShelf();
      return;
    }
    if (!held || e.pointerId !== held.pointerId) return;
    held.x = e.clientX;
    held.y = e.clientY;
    if (!draggingId) {
      const moved = Math.hypot(held.x - held.startX, held.y - held.startY);
      if (held.mouse && moved >= DRAG_THRESHOLD) lift();
      else if (!held.mouse && moved >= SCROLL_SLOP) release();
      return;
    }
    follow();
  }

  function drop(e: PointerEvent) {
    if (heldShelf && e.pointerId === heldShelf.pointerId) {
      const { id, to } = heldShelf;
      const from = sections.findIndex((s) => s.id === id);
      const moved = liftedShelf && to !== null;
      release();
      if (moved && from >= 0) moveShelf(from, to);
      else if (moved) carryShelf(id, to);
      return;
    }
    if (!held || e.pointerId !== held.pointerId) return;
    const { ids, shelf, to } = held;
    if (draggingId) {
      // The click that ends a drag shouldn't open or put back the record under the pointer.
      swallowClick = true;
      setTimeout(() => (swallowClick = false));
    }
    const moved = draggingId && to !== null;
    release();
    if (moved && shelf === CRATE) {
      unsort(ids);
      // Back in the crate, they're no longer picked out.
      selected = new Set([...selected].filter((id) => !ids.includes(id)));
    } else if (moved) moveAlbums(ids, shelf, to);
  }

  // Picked up together, the selected records fly from their places on the shelf to the pointer,
  // one hard on the heels of the next, and only stack up once they're all there.
  const GATHER_MS = 200;
  const STAGGER_MS = 12;
  const GATHER_MAX = 40; // records that fly; any more just join the stack
  let flights = $state.raw<{ album: Album; color: string; from: DOMRect; delay: number }[]>([]);
  let gathered = $state(0);
  let gatherFrame = 0;

  function gather() {
    if (still.matches) return;
    const list = carrying()
      .slice(0, GATHER_MAX)
      .flatMap((album) => {
        const slot = rack?.querySelector<HTMLElement>(`.slot[data-id="${CSS.escape(album.id)}"]`);
        const spine = slot?.querySelector('.spine');
        if (!slot || !spine) return [];
        return [{ album, color: slot.style.getPropertyValue('--spine-bg'), from: spine.getBoundingClientRect() }];
      });
    const stagger = Math.min(STAGGER_MS, 120 / list.length);
    const total = GATHER_MS + (list.length - 1) * stagger;
    flights = list.map((flight, i) => ({ ...flight, delay: i * stagger }));
    gathered = 0;
    const start = performance.now();
    const frame = (now: number) => {
      gathered = now - start;
      if (gathered < total) gatherFrame = requestAnimationFrame(frame);
      else flights = [];
    };
    gatherFrame = requestAnimationFrame(frame);
  }

  // Where a flying record is `t` of the way (eased) from its spine to its place in the stack.
  function flight(from: DOMRect, place: number, delay: number, to: { x: number; y: number }) {
    const t = 1 - (1 - Math.min(Math.max((gathered - delay) / GATHER_MS, 0), 1)) ** 3;
    const at = (a: number, b: number) => a + (b - a) * t;
    const offset = Math.min(place, 2) * 6;
    return {
      t,
      left: at(from.left, to.x - 36 + offset),
      top: at(from.top, to.y - 36 - offset),
      width: at(from.width, 72),
      height: at(from.height, 72),
      rotate: at(0, -4 + Math.min(place, 2) * 4),
    };
  }

  function release() {
    clearTimeout(pressTimer);
    aim(null);
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(gatherFrame);
    flights = [];
    if (held) held.el.style.transform = '';
    if (heldShelf) heldShelf.el.style.transform = '';
    held = null;
    heldShelf = null;
    draggingId = null;
    liftedShelf = null;
    marker = null;
    ghost = null;
    shelfGhost = null;
    receiving = false;
  }

  function swallow(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }

  // Once a finger has picked a record or shelf up, it drags it rather than scrolling the page.
  $effect(() => {
    const hold = (e: TouchEvent) => (draggingId || liftedShelf) && e.preventDefault();
    addEventListener('touchmove', hold, { passive: false });
    return () => removeEventListener('touchmove', hold);
  });

  // The record follows the pointer, and the marker the gap nearest to it on the nearest board.
  function follow() {
    if (!held || !rack) return;
    const { el, x, y } = held;
    if (ghost) ghost = { ...ghost, x, y };
    else {
      const rect = el.getBoundingClientRect();
      held.tx += x - held.grabX - rect.left;
      held.ty += y - held.grabY - rect.top;
      el.style.transform = `translate(${held.tx}px, ${held.ty}px)`;
    }

    held.to = null;
    marker = null;
    if (aimAt(x, y)) return;
    const { ids } = held;
    const from = ids.length === 1 ? where.get(held.id) : undefined;
    // Over the crate, a record from a shelf goes back in; one from the crate just stays put.
    const overCrate = over(dropzone, x, y);
    receiving = overCrate && ids.some((id) => shelved.has(id));
    if (overCrate) {
      if (receiving) [held.shelf, held.to] = [CRATE, 0];
      return;
    }

    let row: HTMLElement | undefined;
    let nearest = Infinity;
    for (const r of rack.querySelectorAll<HTMLElement>('.row')) {
      const { top, bottom } = r.getBoundingClientRect();
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (distance < nearest) [row, nearest] = [r, distance];
    }
    if (!row) return;
    const shelf = Number(row.dataset.shelf);
    const slots = [...row.querySelectorAll<HTMLElement>('.slot')].filter((s) => s !== el && !ids.includes(s.dataset.id!));
    const before = slots.find((s) => {
      const { left, width } = s.getBoundingClientRect();
      return x < left + width / 2;
    });
    const beside = before ?? slots.at(-1);
    // A board with nothing else on it is either an empty shelf or the end of the record's own.
    const to = beside ? where.get(beside.dataset.id!)!.index + (before ? 0 : 1) : shelf === from?.shelf ? from.index : 0;
    if (from && shelf === from.shelf && (to === from.index || to === from.index + 1)) return;
    held.shelf = shelf;
    held.to = to;
    if (beside) {
      const box = beside.getBoundingClientRect();
      const left = before ? box.left - GAP / 2 : box.right + GAP / 2;
      marker = { left: left - 1.5, top: box.top, width: 3, height: box.height };
    } else {
      const box = row.getBoundingClientRect();
      marker = { left: box.left + parseFloat(getComputedStyle(row).paddingLeft), top: box.top, width: 3, height: box.height };
    }
  }

  function over(el: HTMLElement | undefined, x: number, y: number) {
    const box = el?.getBoundingClientRect();
    return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }

  // Whether the pointer is over one of the arrows, turning the rack if it's held there.
  function aimAt(x: number, y: number) {
    const target = [...document.querySelectorAll<HTMLElement>('[data-aim]')].find((el) => over(el, x, y));
    aim(target?.dataset.aim ?? null);
    return !!target;
  }

  function aim(target: string | null) {
    if (target === aiming) return;
    clearTimeout(aimTimer);
    aiming = target;
    if (target) aimTimer = setTimeout(turnHolding, TURN_DELAY);
  }

  // The held record's spine (or shelf's board) goes with the rack it's on, so from here on a
  // stand-in carries it, as for a record out of the crate.
  function turnHolding() {
    if (held && !ghost) {
      held.el.style.transform = '';
      ghost = { albums: carrying(), x: held.x, y: held.y };
    } else if (heldShelf && !shelfGhost) {
      const { id, el, x, y } = heldShelf;
      const section = sections.find((s) => s.id === id)!;
      el.style.transform = '';
      shelfGhost = { label: section.label, count: section.albums.length, x, y };
    } else if (!held && !heldShelf) return;
    const step = Number(aiming);
    if (step) {
      turn(step);
      aimTimer = setTimeout(turnHolding, TURN_DELAY);
    } else {
      go(racks.findIndex((r) => r.id === aiming));
    }
  }

  // The shelf slides up and down with the pointer, and the marker runs along the board it'll land
  // under.
  function followShelf() {
    if (!heldShelf || !rack) return;
    const { el, x, y } = heldShelf;
    if (shelfGhost) shelfGhost = { ...shelfGhost, x, y };
    else el.style.transform = `translateY(${y - heldShelf.startY + scrollY - heldShelf.startScroll}px)`;
    heldShelf.to = null;
    marker = null;
    if (aimAt(x, y)) return;
    // Carried from another rack, it isn't among this one's shelves.
    const from = sections.findIndex((s) => s.id === heldShelf!.id);
    const others = [...rack.querySelectorAll<HTMLElement>('.section')];
    let to = others.findIndex((s, i) => {
      if (i === from) return false;
      const { top, height } = s.getBoundingClientRect();
      return y < top + height / 2;
    });
    if (to === -1) to = others.length;
    if (from >= 0 && (to === from || to === from + 1)) return;
    heldShelf.to = to;
    const edge = to < others.length ? others[to].getBoundingClientRect().top : others.at(-1)!.getBoundingClientRect().bottom;
    const { left, width } = rack.getBoundingClientRect();
    marker = { left, top: edge - BOARD / 2 - 1.5, width, height: 3 };
  }

  function autoScroll() {
    scrollFrame = requestAnimationFrame(autoScroll);
    const y = held?.y ?? heldShelf?.y;
    if (y === undefined) return;
    const speed = y < EDGE ? -(EDGE - y) / 4 : y > innerHeight - EDGE ? (y - innerHeight + EDGE) / 4 : 0;
    if (!speed) return;
    scrollBy(0, speed);
    if (held) follow();
    else followShelf();
  }

  // Arrow keys move the focused record one place along the rack, carrying on onto the next shelf.
  async function nudge(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const id = (e.target as Element).closest<HTMLElement>('.slot')?.dataset.id;
    if (!step || !id) return;
    e.preventDefault();
    const { shelf, index } = where.get(id)!;
    const count = sections[shelf].albums.length;
    if (step < 0 && index > 0) moveAlbum(id, shelf, index - 1);
    else if (step < 0 && shelf > 0) moveAlbum(id, shelf - 1, sections[shelf - 1].albums.length);
    else if (step > 0 && index < count - 1) moveAlbum(id, shelf, index + 2);
    else if (step > 0 && shelf < sections.length - 1) moveAlbum(id, shelf + 1, 0);
    else return;
    await tick();
    rack?.querySelector<HTMLElement>(`.slot[data-id="${CSS.escape(id)}"] .spine`)?.focus();
  }

  // Alt with the up and down arrows in a shelf's label moves the whole shelf.
  async function nudgeShelf(e: KeyboardEvent, from: number) {
    const step = !e.altKey ? 0 : e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    if (from + step < 0 || from + step >= sections.length) return;
    const { id } = sections[from];
    moveShelf(from, step > 0 ? from + 2 : from - 1);
    await tick();
    rack?.querySelector<HTMLElement>(`[data-section="${id}"] .label`)?.focus();
  }

  $effect(() => () => {
    clearTimeout(leaveTimer);
    clearTimeout(aimTimer);
    stopFinger();
    release();
  });

  const still = matchMedia('(prefers-reduced-motion: reduce)');

  function closeOnOutsideClick(e: MouseEvent) {
    const target = e.target as Element;
    if (openId && !target.closest('.slot')) openId = null;
    if (selected.size && !target.closest('.slot, button, input')) deselect();
  }

  function onkeydown(e: KeyboardEvent) {
    if (hover && !held && ['Meta', 'Control', 'Shift'].includes(e.key)) putEverythingBack();
    if (e.key !== 'Escape') return;
    if (held || heldShelf) release();
    else if (openId) openId = null;
    else if (selected.size) deselect();
    else crateOpen = false;
  }
</script>

<svelte:window
  {onkeydown}
  onclick={closeOnOutsideClick}
  onclickcapture={swallow}
  onpointermove={drag}
  onpointerup={drop}
  onpointercancel={release}
/>

<header>
  <h1 class="visually-hidden">Albums</h1>
  <!-- A map of the racks side by side, each shelf a board with its records' colours along it.
       A record or shelf held over one of them goes there. -->
  {#if racks.length > 1}
    <nav
      class="map"
      class:crate-open={crateOpen}
      aria-label="Racks"
      style:--slide="{UNPACK_MS}ms"
      style:--slide-ease={SLIDE_EASING}
    >
      {#each racks as r, i (r.id)}
        {@const labels = r.sections.map((s) => s.label).filter(Boolean).join(' · ')}
        <button
          class="mini"
          class:here={i === here}
          class:aimed={aiming === r.id}
          data-aim={i === here ? undefined : r.id}
          aria-current={i === here || undefined}
          aria-label="Rack {i + 1}{labels ? `: ${labels}` : ''}"
          title={labels || undefined}
          onclick={() => go(i)}
        >
          {#each r.sections as section (section.id)}
            <span class="mini-shelf">
              {#each section.albums.filter((id) => saved.has(id)) as id (id)}
                <span class="mini-spine" style:background={colorOf(id)}></span>
              {/each}
            </span>
          {/each}
        </button>
      {/each}
    </nav>
  {/if}
  <button class="link sign-out" onclick={onsignout}>Sign out</button>
</header>

<!-- The shelf boards run on past the sides of the window, and are cut off there. -->
<div class="window">
  <!-- With the crate open beside it, the whole rack slides over as it is, records running off past
       the far side until the crate is closed again. -->
  <div
    class="room"
    class:crate-open={crateOpen}
    style:--slide="{UNPACK_MS}ms"
    style:--slide-ease={SLIDE_EASING}
  >

    <!-- The board a shelf's records stand on. It carries the shelf's label, and picks the shelf up. -->
    {#snippet board(section: (typeof sections)[number], s: number, labelled: boolean)}
      <!-- svelte-ignore a11y_no_static_element_interactions (Alt+arrows in the label move the shelf by keyboard) -->
      <div class="board" onpointerdown={(e) => pickUpShelf(e, s)}>
        {#if labelled}
          <span class="plate brass" class:blank={!section.label}>
            <input
              class="label"
              value={section.label}
              placeholder="Add label"
              aria-label="Shelf label"
              spellcheck="false"
              onchange={(e) => renameShelf(s, e.currentTarget.value)}
              onkeydown={(e) => (e.key === 'Enter' ? e.currentTarget.blur() : nudgeShelf(e, s))}
            />
          </span>
          {#if sections.length > 1 || racks.length > 1}
            <button class="remove" onclick={() => removeShelf(s)}>Remove shelf</button>
          {/if}
        {/if}
      </div>
    {/snippet}

    {#if albums.length === 0}
      <main class="center"><p class="muted">No saved albums yet. Save some in Spotify and come back.</p></main>
    {:else}
      <main class="rack" class:hover class:carrying={(ghost?.albums.length ?? 0) > 1} bind:this={rack}>
        <div class="measure" bind:clientWidth={available}></div>
        <div class="measure cover-size" bind:clientWidth={coverSize}></div>
        {#key racks[here].id}
          <div in:fly={{ x: 48 * turned, duration: still.matches ? 0 : 260, easing: cubicOut }}>
            {#each sections as section, s (section.id)}
              <section
                class="section"
                class:lifted={liftedShelf === section.id}
                data-section={section.id}
                aria-label={section.label || 'Shelf'}
              >
                <div class="head">
                  <button class="add" onclick={() => addShelf(s)} title="Add a shelf above this one">+ Add shelf</button>
                </div>
                {#if section.albums.length === 0}
                  <div class="shelf">
                    <div class="row empty" data-shelf={s}><span class="muted">Drag albums here</span></div>
                    {@render board(section, s, true)}
                  </div>
                {/if}
                {#each rows[s] ?? [] as shelf, i}
                  <div class="shelf">
                    <div class="clip">
                      <!-- svelte-ignore a11y_no_noninteractive_element_interactions (picking up and nudging records; the spines are the controls) -->
                      <div
                        class="row"
                        class:centered={hover && shelf.room !== null}
                        class:part={hover && shelf.room === null}
                        role="list"
                        data-shelf={s}
                        style:transform={hover ? undefined : shift(shelf)}
                        style:--start={hover && shelf.room === null ? `${partStart(shelf, openId)}px` : undefined}
                        onpointerenter={() => preloadShelf(shelf)}
                        onpointermove={(e) => hoverShelf(shelf, e)}
                        onpointerleave={hoverOut}
                        onpointerdown={pickUp}
                        onclickcapture={select}
                        onkeydown={nudge}
                      >
                        {#each shelf.items as item (item.album.id)}
                          {@const album = item.album}
                          <Spine
                            {album}
                            width={widthOf(shelf, item, openId)}
                            side={item.side}
                            open={openId === album.id}
                            dragging={draggingId === album.id}
                            selected={selected.has(album.id)}
                            ontoggle={() => toggle(album.id)}
                            onplay={(from) => {
                              playAlbum(album, from);
                              openId = null;
                              dismissedId = album.id;
                            }}
                          />
                        {/each}
                      </div>
                    </div>
                    {@render board(section, s, i === 0)}
                  </div>
                {/each}
              </section>
            {/each}
            {#if sections.length}
              <div class="tail"><button class="add" onclick={() => addShelf(sections.length)}>+ Add shelf</button></div>
            {/if}
          </div>
        {/key}
      </main>
    {/if}
  </div>
</div>

<!-- Outside the sliding rack, so their fixed positions are the window's. -->
{#if albums.length}
  <nav class="turns" class:crate-open={crateOpen} style:--slide="{UNPACK_MS}ms" style:--slide-ease={SLIDE_EASING}>
    {#if here > 0}
      <button class="turn prev" class:aimed={aiming === '-1'} data-aim="-1" onclick={() => turn(-1)} aria-label="Previous rack">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
      </button>
    {/if}
    {#if here < racks.length - 1 || !blank(racks[here])}
      {@const last = here === racks.length - 1}
      <button
        class="turn next"
        class:aimed={aiming === '1'}
        data-aim="1"
        onclick={() => turn(1)}
        aria-label={last ? 'New rack' : 'Next rack'}
        title={last ? 'New rack' : undefined}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={last ? 'M8 3v10M3 8h10' : 'M6 3l5 5-5 5'} /></svg>
      </button>
    {/if}
  </nav>
{/if}

{#if marker}
  <div
    class="marker"
    style:left="{marker.left}px"
    style:top="{marker.top}px"
    style:width="{marker.width}px"
    style:height="{marker.height}px"
  ></div>
{/if}

{#if albums.length}
  <Crate
    albums={crate}
    open={crateOpen}
    {receiving}
    {draggingId}
    bind:dropzone
    onopen={() => (crateOpen = true)}
    onclose={() => (crateOpen = false)}
    onpickup={pickUp}
    onplay={(album, from) => playAlbum(album, from)}
  />
{/if}

{#if selected.size}
  <div class="selection" role="status">
    <span>{selected.size} selected</span>
    <span class="muted">Drag one to move them all</span>
    <button class="link" onclick={() => (unsort([...selected]), deselect())}>Back in crate</button>
    <button class="link" onclick={deselect}>Clear</button>
  </div>
{/if}

{#if ghost}
  {#each flights as { album, color, from, delay }, i (album.id)}
    {@const f = flight(from, i, delay, ghost)}
    <div
      class="flyer"
      style:left="{f.left}px"
      style:top="{f.top}px"
      style:width="{f.width}px"
      style:height="{f.height}px"
      style:rotate="{f.rotate}deg"
      style:background={color}
      style:z-index={39 - i}
      aria-hidden="true"
    >
      <img src={album.thumb || album.cover} alt="" style:opacity={f.t} />
    </div>
  {/each}
  <div class="ghost" class:gathering={flights.length > 0} style:translate="{ghost.x}px {ghost.y}px" aria-hidden="true">
    {#each ghost.albums.slice(0, 3) as album, i (album.id)}
      <img src={album.thumb || album.cover} alt="" style:--i={i} />
    {/each}
    {#if ghost.albums.length > 1}
      <span class="count">{ghost.albums.length}</span>
    {/if}
  </div>
{/if}

{#if shelfGhost}
  <div class="shelf-ghost" style:translate="{shelfGhost.x}px {shelfGhost.y}px" aria-hidden="true">
    <span class="brass">{shelfGhost.label || 'Shelf'}</span>
    <span class="count">{shelfGhost.count} {shelfGhost.count === 1 ? 'record' : 'records'}</span>
  </div>
{/if}

<style>
  .window {
    overflow-x: clip;
  }

  .room {
    transition: transform var(--slide) var(--slide-ease);
  }

  @media (min-width: 641px) {
    .room.crate-open {
      transform: translateX(calc(var(--crate-w) + 24px));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .room {
      transition: none;
    }
  }

  /* A record carried out of the crate. */
  .ghost {
    position: fixed;
    z-index: 40;
    top: 0;
    left: 0;
    width: 72px;
    height: 72px;
    margin: -36px 0 0 -36px;
    pointer-events: none;
    rotate: -4deg;
    box-shadow: 0 14px 28px -8px rgb(0 0 0 / 0.6);
  }

  .ghost.gathering {
    opacity: 0;
  }

  /* A selected record on its way from the shelf to the stack under the pointer. */
  .flyer {
    position: fixed;
    pointer-events: none;
    border-radius: 2px;
    box-shadow: 0 6px 14px -6px rgb(0 0 0 / 0.5);
    overflow: hidden;
  }

  .flyer img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .ghost img {
    position: absolute;
    inset: 0;
    z-index: calc(3 - var(--i));
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 2px;
    background: var(--line);
    translate: calc(var(--i) * 6px) calc(var(--i) * -6px);
    rotate: calc(var(--i) * 4deg);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.35);
  }

  .ghost .count {
    position: absolute;
    z-index: 4;
    top: -10px;
    right: -14px;
    min-width: 22px;
    padding: 2px 6px;
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: center;
    color: #fff;
    background: var(--focus);
    border-radius: 999px;
    rotate: 4deg;
  }

  /* A shelf carried to another rack: a short length of its board, with its plate. */
  .shelf-ghost {
    position: fixed;
    z-index: 40;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    height: var(--board);
    margin: calc(var(--board) / -2) 0 0 -40px;
    padding: 3px 16px 0;
    pointer-events: none;
    background: linear-gradient(var(--board-top) 0 3px, var(--board-face) 3px, var(--board-edge));
    border-radius: 2px;
    box-shadow: 0 14px 28px -8px rgb(0 0 0 / 0.6);
    rotate: -2deg;
  }

  .shelf-ghost .count {
    font-size: 0.75rem;
    white-space: nowrap;
    color: rgb(255 255 255 / 0.75);
  }

  /* What's selected, and what can be done with it all at once. */
  .selection {
    position: fixed;
    z-index: 12;
    left: 50%;
    bottom: 24px;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 16px;
    font-size: 0.8125rem;
    white-space: nowrap;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 999px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
  }

  .selection .link {
    font-size: inherit;
  }

  /* The selected records left behind while a stand-in carries them. */
  .rack.carrying :global(.slot.selected) {
    opacity: 0.35;
  }

  header {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    padding: 28px var(--gutter) 8px;
  }

  .sign-out {
    grid-column: 3;
    justify-self: end;
  }

  .map {
    grid-column: 2;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    transition: translate var(--slide) var(--slide-ease);
  }

  /* Centred in what's left of the window beside the open crate. */
  @media (min-width: 641px) {
    .map.crate-open {
      translate: calc((var(--crate-w) + 24px) / 2) 0;
    }
  }

  .mini {
    all: unset;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 70px;
    padding: 5px 7px 4px;
    border: 1px solid var(--line);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.7;
    transition:
      opacity 0.15s ease,
      border-color 0.15s ease,
      scale 0.15s ease;
  }

  .mini:hover,
  .mini.here {
    opacity: 1;
  }

  .mini.here {
    border-color: var(--muted);
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }

  .mini.aimed {
    opacity: 1;
    border-color: var(--focus);
    scale: 1.1;
  }

  .mini:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .mini-shelf {
    display: flex;
    align-items: flex-end;
    height: 12px;
    border-bottom: 2px solid var(--board-top);
  }

  .mini-spine {
    flex: 0 1 3px;
    min-width: 0;
    height: 9px;
    box-shadow: inset -0.5px 0 rgb(0 0 0 / 0.35);
  }

  @media (prefers-reduced-motion: reduce) {
    .map,
    .mini {
      transition: none;
    }
  }

  /* Arrows at the sides of the window, to the racks beside this one. */
  .turn {
    all: unset;
    position: fixed;
    z-index: 12;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--muted);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid var(--line);
    cursor: pointer;
    transition:
      left var(--slide) var(--slide-ease),
      color 0.15s ease,
      scale 0.15s ease;
  }

  .turn svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .turn:hover {
    color: var(--text);
  }

  .turn.aimed {
    color: var(--focus);
    border-color: var(--focus);
    scale: 1.15;
  }

  .turn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .prev {
    left: 2px;
  }

  .next {
    right: 2px;
  }

  /* Beside the open crate rather than under it. */
  @media (min-width: 641px) {
    .turns.crate-open .prev {
      left: calc(var(--crate-w) + 24px + 2px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .turn {
      transition: none;
    }
  }

  .rack {
    padding: 8px 0 380px; /* room to scroll the last shelf clear of the turntable */
    user-select: none;
    -webkit-user-select: none;
  }

  /* Where a dragged record or shelf will land. */
  .marker {
    position: fixed;
    z-index: 20;
    border-radius: 2px;
    background: var(--focus);
    pointer-events: none;
  }

  .measure {
    height: 0;
    margin: 0 var(--gutter);
  }

  .cover-size {
    width: var(--h);
  }

  .section {
    position: relative;
    display: flow-root; /* its box takes in the board below it */
  }

  .section.lifted {
    z-index: 15;
    opacity: 0.85;
  }

  /* The space under the board above, where another shelf can go in. */
  .head {
    position: relative;
    display: grid;
    place-items: center;
    height: 40px;
    margin-bottom: 10px;
  }

  /* The board runs past both sides of the window, as if the shelf carries on, so it still does
     while the rack slides over for the crate (and on behind the open crate). */
  .board {
    position: absolute;
    top: 100%;
    left: calc(-24px - var(--crate-w));
    right: calc(-24px - var(--crate-w));
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--board);
    padding: 3px calc(var(--gutter) + 24px + var(--crate-w)) 0;
    background: linear-gradient(var(--board-top) 0 3px, var(--board-face) 3px, var(--board-edge));
    box-shadow: 0 10px 14px -8px var(--board-shadow);
    cursor: grab;
    -webkit-touch-callout: none;
  }

  .lifted .board {
    cursor: grabbing;
  }

  /* The label lines up with the records: past the spare cover room on a hover shelf. */
  .hover .board {
    padding-left: calc(var(--gutter) + (var(--h) - 32px) / 2 + 24px + var(--crate-w));
  }

  /* A little brass plate (see .brass), screwed to the front of the board. */
  .plate {
    cursor: text;
  }

  .plate:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .label {
    field-sizing: content;
    min-width: 3ch;
    max-width: 40ch;
    padding: 0;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    text-shadow: inherit;
    background: none;
    border: 0;
    outline: none;
    user-select: text;
    -webkit-user-select: text;
  }

  /* An unlabelled shelf only offers a plate where it's being looked at. */
  .plate.blank:not(:focus-within) {
    background: none;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.3);
    opacity: 0;
  }

  .plate.blank:not(:focus-within)::before,
  .plate.blank:not(:focus-within)::after {
    display: none;
  }

  .plate.blank .label::placeholder {
    color: rgb(255 255 255 / 0.7);
    text-shadow: none;
  }

  .board:hover .plate.blank {
    opacity: 1;
  }

  .remove {
    all: unset;
    margin-left: auto;
    font-size: 0.75rem;
    color: rgb(255 255 255 / 0.65);
    cursor: pointer;
    opacity: 0;
  }

  .remove:hover {
    color: #fff;
  }

  .board:hover .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .tail {
    display: grid;
    place-items: center;
    height: 64px;
  }

  .add {
    all: unset;
    font-size: 0.8125rem;
    color: var(--muted);
    padding: 4px 12px;
    border: 1px dashed var(--line);
    border-radius: 999px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .head:hover .add,
  .tail:hover .add,
  .add:focus-visible {
    opacity: 1;
  }

  .add:hover {
    color: var(--text);
  }

  /* Without a mouse to reveal them, the shelf controls stay in view. */
  @media (hover: none) {
    .add,
    .remove,
    .plate.blank:not(:focus-within) {
      opacity: 1;
    }
  }

  .shelf {
    position: relative;
    margin-bottom: calc(var(--board) + 40px);
  }

  .shelf:last-child {
    margin-bottom: var(--board); /* just the board */
  }

  /* Records pushed past the window edge disappear, without clipping the lift above the shelf. */
  .clip {
    overflow-x: clip;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: var(--h);
    padding: 0 var(--gutter);
    transition: transform var(--turn) var(--ease);
  }

  .row.empty {
    align-items: center;
    justify-content: center;
    height: calc(var(--h) / 2);
    font-size: 0.875rem;
  }

  /* Hover shelves keep their spare room split evenly on both sides until a cover fills it. */
  .row.centered {
    justify-content: center;
  }

  .row.part {
    padding-left: calc(var(--gutter) + var(--start));
    transition:
      transform var(--turn) var(--ease),
      padding-left var(--turn) var(--ease);
  }
</style>
