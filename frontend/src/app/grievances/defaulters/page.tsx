import { redirect } from 'next/navigation';

export default function GrievancesDefaultersRedirect() {
  redirect('/dashboard?tab=defaulters');
}
