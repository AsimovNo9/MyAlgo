export const youtubePageFixtures = [
  {
    surface: 'home',
    href: '/watch?v=home-video',
    title: 'Home recommendations',
    expectedId: 'home-video',
  },
  {
    surface: 'subscriptions',
    href: '/watch?v=subscriptions-video',
    title: 'Subscription upload',
    expectedId: 'subscriptions-video',
  },
  {
    surface: 'search',
    href: '/watch?v=search-video',
    title: 'Search result',
    expectedId: 'search-video',
  },
  {
    surface: 'shorts',
    href: '/shorts/shorts-video',
    title: 'Shorts feed item',
    expectedId: 'shorts-video',
  },
  {
    surface: 'home-live',
    href: '/live/live-video',
    title: 'Live recommendation',
    expectedId: 'live-video',
  },
] as const;