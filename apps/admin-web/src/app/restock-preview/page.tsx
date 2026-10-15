import { notFound } from 'next/navigation';
import { RestockPreview } from './preview';

export default function RestockPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return <RestockPreview />;
}
