import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
