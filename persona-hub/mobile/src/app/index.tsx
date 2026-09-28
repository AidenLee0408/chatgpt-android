import { Redirect } from 'expo-router';
import { useSession } from '../state/session';

/** Entry: route by session so a signed-out user never lands on a tab that 401s. */
export default function Index() {
  const { status, onboardingPending } = useSession();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/login" />;
  return <Redirect href={onboardingPending ? '/onboarding/intro' : '/personas'} />;
}
