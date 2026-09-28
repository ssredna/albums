<script lang="ts">
  import { onMount } from 'svelte';
  import { completeLogin, isSignedIn, login, logout } from './lib/auth';
  import { AuthError, fetchAlbums, type Album } from './lib/spotify';
  import { clearAlbums, loadAlbums, saveAlbums } from './lib/cache';
  import Rack from './components/Rack.svelte';
  import Player from './components/Player.svelte';
  import { disconnect } from './lib/player.svelte';

  let ready = $state(false);
  let signedIn = $state(false);
  let albums = $state.raw<Album[] | null>(null);
  let progress = $state<{ loaded: number; total: number } | null>(null);
  let error = $state<string | null>(null);

  const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

  onMount(async () => {
    try {
      await completeLogin();
    } catch (err) {
      error = message(err);
    }
    signedIn = isSignedIn();
    ready = true;
    if (signedIn) {
      albums = loadAlbums();
      load();
    }
  });

  // Shows the cached rack immediately (if any) and swaps in fresh data when it arrives.
  async function load() {
    try {
      const fresh = await fetchAlbums((loaded, total) => {
        if (!albums) progress = { loaded, total };
      });
      albums = fresh;
      saveAlbums(fresh);
    } catch (err) {
      if (err instanceof AuthError) signOut();
      error = message(err);
    } finally {
      progress = null;
    }
  }

  async function signIn() {
    error = null;
    try {
      await login();
    } catch (err) {
      error = message(err);
    }
  }

  function signOut() {
    disconnect();
    logout();
    clearAlbums();
    signedIn = false;
    albums = null;
  }
</script>

{#if !ready}
  <!-- Resolving the sign-in callback -->
{:else if !signedIn}
  <main class="center">
    <h1>Album Rack</h1>
    <p class="muted">Your saved Spotify albums, on a shelf.</p>
    <button class="primary" onclick={signIn}>Sign in with Spotify</button>
    {#if error}<p class="error">{error}</p>{/if}
  </main>
{:else if albums}
  <Rack {albums} onsignout={signOut} />
  <Player />
  {#if error}<p class="error toast" role="alert">{error}</p>{/if}
{:else}
  <main class="center">
    <p class="muted">
      Pulling records{progress ? ` — ${progress.loaded} of ${progress.total}` : '…'}
    </p>
    {#if error}
      <p class="error">{error}</p>
      <button class="primary" onclick={load}>Try again</button>
    {/if}
  </main>
{/if}
