/**
 * Career path types shared by the Nuxt site and the Azure Functions API.
 * This is the single source of truth for the public careers contract.
 */

export interface Career {
  id: string
  title: string
  slug: string
  /** HTML string, plain string or Payload Lexical rich-text JSON. */
  content?: unknown
}

export interface PaginatedCareers {
  docs: Career[]
  totalDocs: number
  limit: number
  totalPages: number
  page: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface ApiError {
  error: string
}

export function emptyCareerPage(limit = 10): PaginatedCareers {
  return {
    docs: [],
    totalDocs: 0,
    limit,
    totalPages: 0,
    page: 1,
    hasNextPage: false,
    hasPrevPage: false,
  }
}
