<script setup lang="ts">
const { siteName } = useRuntimeConfig().public
</script>

<template>
  <div class="shell">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="container site-header__inner">
        <NuxtLink to="/" class="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" class="brand__mark">
          {{ siteName }}
        </NuxtLink>
        <nav aria-label="Main">
          <NuxtLink to="/">Home</NuxtLink>
          <NuxtLink to="/careers">Career paths</NuxtLink>
        </nav>
      </div>
    </header>

    <main id="main" class="container site-main">
      <slot />
    </main>

    <footer class="site-footer">
      <div class="container">
        {{ siteName }} · Helping students discover where their talents can take them
      </div>
    </footer>
  </div>
</template>
