import './style.css';

export const metadata = {
  title: 'Hati — personal budget',
  description: 'A personal budget, wherever you are.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Hati', statusBarStyle: 'default' },
};
export const viewport = { themeColor: '#f8f7f2', width: 'device-width', initialScale: 1 };

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
