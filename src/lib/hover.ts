import { MediaQuery } from 'svelte/reactivity';

/** A real mouse or trackpad, where covers can open on hover instead of on click. */
export const canHover = new MediaQuery('(hover: hover) and (pointer: fine)');
