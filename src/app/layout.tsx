import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FB Engagement Controller',
  description: 'Dashboard pengelolaan kampanye engagement',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
