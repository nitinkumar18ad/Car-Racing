import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0d12',
};

export const metadata: Metadata = {
  title: 'Apex Circuit — 3D Motorsport Racing Game',
  description:
    'High-speed 3D browser racing game powered by Three.js and WebGL. Race the classic Jaguar XJ13 in Circuit and Time Lap modes across realistic Grand Prix environments.',
  keywords: [
    'car racing game',
    '3d racing',
    'threejs game',
    'webgl racing',
    'motorsport simulator',
    'jaguar xj13',
    'browser game',
    'apex circuit',
  ],
  authors: [{ name: 'Apex Circuit Team' }],
  manifest: '/manifest.json',
  openGraph: {
    title: 'Apex Circuit — 3D Motorsport Racing Game',
    description:
      'High-speed 3D browser racing game. Experience authentic car physics, multiple camera perspectives including Cockpit FPP, and rich Grand Prix scenery.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Apex Circuit',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Apex Circuit — 3D Motorsport Racing Game',
    description: 'High-speed 3D browser racing game powered by Three.js and WebGL.',
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
