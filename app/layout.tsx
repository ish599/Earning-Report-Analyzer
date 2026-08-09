import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RH Earnings Sentiment vs Price Impact',
  description: 'Sentiment from earnings call transcripts vs stock returns (7–30 days)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
