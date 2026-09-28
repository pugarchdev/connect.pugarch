import { redirect } from 'next/navigation';

export default function GrievancesPage() {
  redirect('/dashboard?tab=grievances');
}
