<script setup lang="ts">
import type { Career } from '#careers/types'
import { toExcerpt } from '#careers/rich-text'

const props = defineProps<{ career: Career; headingLevel?: 'h2' | 'h3' }>()

const excerpt = computed(() => toExcerpt(props.career.content, 180))
</script>

<template>
  <article class="career-card">
    <component :is="headingLevel ?? 'h2'" class="career-card__title">
      <!-- A single stretched link makes the whole card clickable. -->
      <NuxtLink :to="`/careers/${career.slug}`" class="stretched-link">{{ career.title }}</NuxtLink>
    </component>
    <p v-if="excerpt" class="career-card__excerpt">{{ excerpt }}</p>
    <p class="career-card__more" aria-hidden="true">Explore this career →</p>
  </article>
</template>
