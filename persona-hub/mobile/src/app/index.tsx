import { Redirect } from 'expo-router';

/** Entry: the auth gate in _layout decides; default to the personas tab. */
export default function Index() {
  return <Redirect href="/personas" />;
}
