/** @format */

import { Toaster } from 'sonner';

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 ">
      {children} <Toaster />
    </section>
  );
}
