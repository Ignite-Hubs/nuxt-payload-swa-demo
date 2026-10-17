import type { Career, PaginatedCareers } from '#careers/types'
import { emptyCareerPage } from '#careers/types'

/**
 * First page of published career paths. During `nuxt generate` this resolves via
 * the local Nitro route (which calls Payload directly); in the browser it
 * calls the Azure Functions API.
 */
export function useCareers(limit = 12) {
  return useFetch<PaginatedCareers>('/api/careers', {
    key: `careers-${limit}`,
    query: { limit },
    default: () => emptyCareerPage(limit),
  })
}

export function useCareer(slug: string) {
  return useFetch<Career>(`/api/careers/${encodeURIComponent(slug)}`, {
    key: `career-${slug}`,
  })
}

/** "Load more" pagination on top of a first page, fetched live from the API. */
export function useMoreCareers(firstPage: Ref<PaginatedCareers>) {
  const extra = ref<Career[]>([])
  const lastPage = ref<PaginatedCareers | null>(null)
  const loading = ref(false)
  const failed = ref(false)

  // A fresh first page (e.g. after revalidation) resets anything appended.
  watch(firstPage, () => {
    extra.value = []
    lastPage.value = null
  })

  const careers = computed(() => [...firstPage.value.docs, ...extra.value])
  const hasMore = computed(() => (lastPage.value ?? firstPage.value).hasNextPage)

  async function loadMore() {
    const current = lastPage.value ?? firstPage.value
    loading.value = true
    failed.value = false
    try {
      const next = await $fetch<PaginatedCareers>('/api/careers', {
        query: { limit: current.limit, page: current.page + 1 },
      })
      extra.value.push(...next.docs)
      lastPage.value = next
    } catch {
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  return { careers, hasMore, loadMore, loading, failed }
}

/**
 * Prerendered HTML reflects the last build. After mount, re-read the live API
 * so unpublished or edited career paths are reflected without waiting for a rebuild.
 * Failures are ignored: the prerendered content remains a valid fallback.
 */
export function useRevalidate(revalidate: () => Promise<void>) {
  onMounted(() => {
    revalidate().catch(() => {})
  })
}
