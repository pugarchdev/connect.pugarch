import { redirect } from 'next/navigation';

export default function DefaultersPage() {
  redirect('/dashboard?tab=defaulters');
}
