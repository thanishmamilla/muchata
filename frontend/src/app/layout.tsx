import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  weight: ['300', '400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Google Meet Clone - Enterprise Level',
  description: 'Ultra low-latency HD video conferencing and real-time collaboration workspace built with WebRTC, Socket.IO, and Next.js.',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
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
