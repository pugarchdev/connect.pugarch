import { redirect } from 'next/navigation';

export default function FlowsPage() {
  redirect('/dashboard?tab=flows');
}
