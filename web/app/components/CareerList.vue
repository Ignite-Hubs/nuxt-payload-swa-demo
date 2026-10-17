<script setup lang="ts">
import type { Career } from '#careers/types'

defineProps<{ careers: Career[]; headingLevel?: 'h2' | 'h3' }>()
</script>

<template>
  <ul class="career-list">
    <li v-for="career in careers" :key="career.id">
      <CareerCard :career="career" :heading-level="headingLevel" />
    </li>
  </ul>
</template>
