import { redirect } from 'next/navigation';

export default function RolesPage() {
  redirect('/dashboard?tab=roles');
}
