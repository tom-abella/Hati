import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.js',
  swDest: 'public/sw.js',
  additionalPrecacheEntries: [{ url: '/', revision: String(Date.now()) }],
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist({});
