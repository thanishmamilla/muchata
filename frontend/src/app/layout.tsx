import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['300', '400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Muchhata.ai',
  description: 'Ultra low-latency HD video conferencing and real-time collaboration workspace built with WebRTC, Socket.IO, and Next.js.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#070b13',
};


export default function RootLayout({
  children,
  }: Readonly<{
    children: React.ReactNode;
  }>) {
  return (
    <html lang="en" className={`${outfit.variable}`}>
      <body className="antialiased min-h-screen bg-[#0b0f19] text-[#e2e8f0]">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
