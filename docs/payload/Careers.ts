/**
 * Reference Payload 3 collection matching the model this app expects: one
 * document per career path students can explore. It mirrors the demo instance
 * (HTML `content` + a `published` checkbox). Copy into your Payload project
 * (e.g. src/collections/Careers.ts) and add it to `collections` in
 * payload.config.ts. Not used by this repository's build.
 */
import type { CollectionConfig } from 'payload'
import { triggerSiteRebuild } from './triggerSiteRebuild'

export const Careers: CollectionConfig = {
  slug: 'careers',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'published', 'updatedAt'],
  },
  access: {
    // Public visitors may read published career paths only; the site's API key
    // (a logged-in service account) can read all, and the app filters itself.
    read: ({ req }) => (req.user ? true : { published: { equals: true } }),
  },
  hooks: {
    afterChange: [triggerSiteRebuild],
    afterDelete: [triggerSiteRebuild],
  },
  fields: [
    { name: 'title', type: 'text', required: true, admin: { description: 'Career role, e.g. "Civil Engineer"' } },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Lowercase words separated by hyphens' },
      validate: (value: unknown) =>
        typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
          ? true
          : 'Use lowercase letters, numbers and hyphens only',
    },
    {
      name: 'content',
      type: 'textarea',
      admin: {
        description:
          'HTML, e.g. <h2>…</h2><p>…</p><ul><li>…</li></ul>. The first <p> is used as the summary on cards and in search results.',
      },
    },
    { name: 'published', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
  ],
}
